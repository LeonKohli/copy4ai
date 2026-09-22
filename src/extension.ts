import * as vscode from 'vscode';

import { Copy4AIOptions, FileContent, ProcessFileOptions, ProgressReporter, CancellationToken } from './types';
import { ConfigurationService } from './utils/configuration';
import { FileProcessor } from './utils/fileProcessor';
import { ProjectTreeGenerator } from './utils/projectTree';
import { CopyFeedbackReporter } from './utils/feedback';
import { OutputFormatter } from './utils/formatters';
import { IgnoreUtils } from './utils/ignoreUtils';
import { LastCopyStore } from './utils/lastCopy';
import { TokenCounter } from './utils/tokenCounter';
import { UriUtils } from './utils/uriUtils';
import { ScmChangesService } from './utils/scmChanges';

type KeyboardSelectionProvider = () => Promise<ReadonlyArray<vscode.Uri>>;

export class Copy4AIService {

    // Swappable system boundary: tests replace this with an in-memory clipboard
    // (vscode.env.clipboard is Object.frozen, so it cannot be stubbed in-place)
    public static clipboard: vscode.Clipboard = vscode.env.clipboard;

    public static keyboardSelectionProvider: KeyboardSelectionProvider =
        async () => Copy4AIService.getKeyboardSelectedResources();

    public static async copyToClipboard(
        uri?: vscode.Uri,
        uris?: ReadonlyArray<vscode.Uri>,
        options: Readonly<Copy4AIOptions> = {}
    ): Promise<void> {
        // Copying a few thousand files takes about a second, so progress is
        // background noise: it belongs in the status bar, not in a notification.
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Window,
            title: "Copy4AI"
        }, async (progress: ProgressReporter, token: CancellationToken) => {
            try {
                progress.report({ increment: 0, message: "Initializing..." });
                const itemsToProcess = await this.resolveItemsToProcess(uri, uris);

                if (itemsToProcess.length === 0) {
                    throw new Error('No files or folders selected');
                }

                const workspaceFolder = this.getCommonWorkspaceFolder(itemsToProcess);
                const config = ConfigurationService.getConfiguration(itemsToProcess[0]);
                const excludeConfig = ConfigurationService.getExcludeConfig(itemsToProcess[0]);

                // Options override global configuration for command-specific behavior
                // This allows different commands to use different settings without changing user preferences
                const includeProjectTree = options.projectTreeOnly ? true :
                                         (options.includeProjectTree !== undefined ?
                                         options.includeProjectTree :
                                         config.includeProjectTree);

                progress.report({ increment: 10, message: "Setting up file filters..." });

                const ig = IgnoreUtils.createIgnoreInstance(excludeConfig.patterns, config.ignoreDotFiles);

                if (config.ignoreGitIgnore) {
                    await IgnoreUtils.addGitIgnoreRules(workspaceFolder.uri, ig);
                }

                const isExcludedByResourcePath = IgnoreUtils.createResourcePathExclusionFn(
                    workspaceFolder.uri,
                    excludeConfig.paths
                );

                const shouldExcludeContent = IgnoreUtils.createResourceContentExclusionFn(
                    workspaceFolder.uri,
                    config.excludeContentPatterns
                );

                const copyableItems: { uri: vscode.Uri; stats: vscode.FileStat }[] = [];
                const skippedMissingFiles: string[] = [];
                if (!options.projectTreeOnly) {
                    for (const item of itemsToProcess) {
                        if (token.isCancellationRequested) {
                            throw new vscode.CancellationError();
                        }
                        let stats: vscode.FileStat;
                        try {
                            stats = await vscode.workspace.fs.stat(item);
                        } catch (error) {
                            if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
                                skippedMissingFiles.push(UriUtils.basename(item));
                                continue;
                            }
                            throw error;
                        }
                        const relativePath = UriUtils.relativePath(workspaceFolder.uri, item);
                        if (!isExcludedByResourcePath(item) &&
                            !IgnoreUtils.isIgnored(ig, relativePath, !!(stats.type & vscode.FileType.Directory))) {
                            copyableItems.push({ uri: item, stats });
                        }
                    }
                    if (skippedMissingFiles.length === itemsToProcess.length) {
                        throw new Error(`Selected file(s) no longer exist on disk: ${skippedMissingFiles.join(', ')}`);
                    }
                }

                // A single selected folder becomes the tree root, like the folder view it came from
                const selectedFolder = itemsToProcess.length === 1 &&
                    (await vscode.workspace.fs.stat(itemsToProcess[0])).type & vscode.FileType.Directory
                    ? itemsToProcess[0] : undefined;

                progress.report({ increment: 15, message: "Generating project tree..." });
                let projectTree = '';
                if (includeProjectTree) {
                    const selectedPaths = copyableItems.map(item => UriUtils.relativePath(workspaceFolder.uri, item.uri));
                    const isExcludedFromTree = (resourceUri: vscode.Uri): boolean => {
                        if (isExcludedByResourcePath(resourceUri)) {
                            return true;
                        }
                        if (options.projectTreeOnly) {
                            return false;
                        }

                        const relativePath = UriUtils.relativePath(workspaceFolder.uri, resourceUri);
                        return !selectedPaths.some(selectedPath =>
                            selectedPath === '' ||
                            relativePath === selectedPath ||
                            relativePath.startsWith(`${selectedPath}/`) ||
                            selectedPath.startsWith(`${relativePath}/`)
                        );
                    };

                    projectTree = await ProjectTreeGenerator.generateProjectTree(
                        selectedFolder ?? workspaceFolder.uri,
                        ig,
                        config.maxDepth,
                        0,
                        '',
                        isExcludedFromTree,
                        token,
                        workspaceFolder.uri
                    );

                    if (selectedFolder) {
                        projectTree = `${UriUtils.basename(selectedFolder)}/\n${projectTree}`;
                    }
                }

                let processedContent: FileContent[] = [];

                if (!options.projectTreeOnly) {
                    progress.report({ increment: 20, message: "Processing files..." });

                    const processOptions: ProcessFileOptions = {
                        maxFileSize: config.maxFileSize,
                        isExcludedByResourcePath,
                        shouldExcludeContent,
                        cancellationToken: token
                    };

                    const totalItems = copyableItems.length;
                    for (let i = 0; i < totalItems; i++) {
                        if (token.isCancellationRequested) {
                            throw new vscode.CancellationError();
                        }

                        const { uri: item, stats } = copyableItems[i];
                        progress.report({
                            increment: 40 / totalItems,
                            message: `Processing ${i+1}/${totalItems}: ${UriUtils.basename(item)}`
                        });

                        if (stats.type & vscode.FileType.Directory) {
                            const dirResults = await FileProcessor.processDirectory(
                                item,
                                workspaceFolder.uri,
                                ig,
                                processOptions
                            );
                            processedContent.push(...dirResults);
                        } else {
                            const fileContent = await FileProcessor.processFile(
                                item,
                                workspaceFolder.uri,
                                ig,
                                processOptions
                            );
                            if (fileContent) {
                                processedContent.push(fileContent);
                            }
                        }
                    }
                }

                progress.report({ increment: 10, message: "Formatting output..." });

                let formattedContent: string;
                if (options.projectTreeOnly) {
                    formattedContent = OutputFormatter.formatProjectStructureOnly(
                        config.outputFormat,
                        projectTree
                    );
                } else {
                    formattedContent = OutputFormatter.formatOutput(
                        config.outputFormat,
                        projectTree,
                        processedContent
                    );
                }

                progress.report({ increment: 5, message: "Copying to clipboard..." });
                await this.clipboard.writeText(formattedContent);

                // A tree-only copy is not a file selection: repeating it would
                // copy contents the user never asked for.
                if (!options.projectTreeOnly) {
                    await LastCopyStore.remember(itemsToProcess);
                }

                if (config.enableTokenCounting && !options.projectTreeOnly) {
                    progress.report({ increment: 5, message: "Counting tokens..." });
                    await TokenCounter.showTokenInfo(
                        formattedContent,
                        config.llmModel,
                        config.outputFormat,
                        config.enableTokenWarning,
                        config.maxTokens
                    );
                } else {
                    CopyFeedbackReporter.report(`Copied to clipboard (${config.outputFormat})`);
                }

                if (skippedMissingFiles.length > 0) {
                    vscode.window.showWarningMessage(
                        `Copy4AI: Skipped ${skippedMissingFiles.length} deleted file(s): ${skippedMissingFiles.join(', ')}`
                    );
                }

            } catch (error) {
                if (error instanceof vscode.CancellationError || token.isCancellationRequested) {
                    vscode.window.showInformationMessage('Copy4AI: Operation cancelled.');
                    return;
                }

                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Copy4AI Error: ${errorMessage}`);
                throw error;
            }
        });
    }

    /**
     * Copies the last selection again, read fresh from disk. Nothing about the
     * result is cached: folders are re-read, exclusion rules re-applied, and
     * files deleted since then are skipped with a warning.
     */
    public static async repeatLastCopy(): Promise<void> {
        const items = LastCopyStore.get();
        if (items.length === 0) {
            vscode.window.showInformationMessage('Copy4AI: Nothing to repeat yet. Copy a selection first.');
            return;
        }

        await this.copyToClipboard(undefined, items);
    }

    public static async copyScmChanges(uris: ReadonlyArray<vscode.Uri>): Promise<void> {
        try {
            const itemsToProcess = await this.dedupeCoveredItems(uris);
            if (itemsToProcess.length === 0) {
                throw new Error('No files selected');
            }

            const api = await ScmChangesService.getGitApi();
            const diff = await ScmChangesService.collectDiffs(api, itemsToProcess);

            const config = ConfigurationService.getConfiguration(itemsToProcess[0]);
            const formattedContent = OutputFormatter.formatScmChangesOutput(config.outputFormat, diff);
            await this.clipboard.writeText(formattedContent);

            if (config.enableTokenCounting) {
                await TokenCounter.showTokenInfo(
                    formattedContent,
                    config.llmModel,
                    config.outputFormat,
                    config.enableTokenWarning,
                    config.maxTokens
                );
            } else {
                CopyFeedbackReporter.report(`Copied changes to clipboard (${config.outputFormat})`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Copy4AI Error: ${errorMessage}`);
            throw error;
        }
    }

    private static resolveItemsToProcess(
        uri?: vscode.Uri,
        uris?: ReadonlyArray<vscode.Uri>
    ): Promise<vscode.Uri[]> {
        if (uris && uris.length > 0) {
            return this.dedupeCoveredItems(uris);
        }
        if (uri) {
            return Promise.resolve([uri]);
        }

        return this.resolveKeyboardOrActiveEditorItems();
    }

    private static async resolveKeyboardOrActiveEditorItems(): Promise<vscode.Uri[]> {
        const keyboardSelection = await this.keyboardSelectionProvider();
        if (keyboardSelection.length > 0) {
            return this.dedupeCoveredItems(keyboardSelection);
        }

        const activeEditorUri = vscode.window.activeTextEditor?.document.uri;
        return activeEditorUri ? [activeEditorUri] : [];
    }

    private static async getKeyboardSelectedResources(): Promise<vscode.Uri[]> {
        const previousClipboardText = await vscode.env.clipboard.readText();
        const sentinel = `copy4ai-selection-probe:${Date.now()}:${Math.random()}`;
        let probeText = sentinel;

        // VS Code does not expose Explorer multi-selection to extension commands
        // invoked by keybinding. Its own copyFilePath command can resolve that
        // focused-list selection, so use it as a temporary bridge and restore
        // the clipboard before Copy4AI writes the final output.
        await vscode.env.clipboard.writeText(sentinel);
        try {
            await vscode.commands.executeCommand('copyFilePath');
            probeText = await vscode.env.clipboard.readText();

            if (probeText === sentinel) {
                return [];
            }

            return this.parseFilePathClipboard(probeText);
        } finally {
            const currentClipboardText = await vscode.env.clipboard.readText();
            if (currentClipboardText === sentinel || currentClipboardText === probeText) {
                await vscode.env.clipboard.writeText(previousClipboardText);
            }
        }
    }

    private static parseFilePathClipboard(value: string): vscode.Uri[] {
        return value
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean)
            .map(item => this.uriFromClipboardPath(item));
    }

    private static uriFromClipboardPath(value: string): vscode.Uri {
        if (this.looksLikeUri(value) && !this.looksLikeWindowsDrivePath(value)) {
            return vscode.Uri.parse(value);
        }

        return vscode.Uri.file(value);
    }

    private static looksLikeUri(value: string): boolean {
        return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
    }

    private static looksLikeWindowsDrivePath(value: string): boolean {
        return /^[A-Za-z]:[\\/]/.test(value);
    }

    private static async dedupeCoveredItems(items: ReadonlyArray<vscode.Uri>): Promise<vscode.Uri[]> {
        const seen = new Set<string>();
        const uniqueItems = items.filter(item => {
            const key = item.toString();
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });

        const selectedDirectories: vscode.Uri[] = [];
        for (const item of uniqueItems) {
            try {
                const stats = await vscode.workspace.fs.stat(item);
                if (stats.type & vscode.FileType.Directory) {
                    selectedDirectories.push(item);
                }
            } catch (error) {
                if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) {
                    throw error;
                }
            }
        }

        if (selectedDirectories.length === 0) {
            return uniqueItems;
        }

        return uniqueItems.filter(item => {
            return !selectedDirectories.some(directory => this.isCoveredBySelectedDirectory(directory, item));
        });
    }

    private static isCoveredBySelectedDirectory(directory: vscode.Uri, item: vscode.Uri): boolean {
        if (directory.toString() === item.toString()) {
            return false;
        }

        try {
            return this.isDescendantPath(UriUtils.relativePath(directory, item));
        } catch {
            return false;
        }
    }

    private static isDescendantPath(relativePath: string): boolean {
        return relativePath !== '' && relativePath !== '..' && !relativePath.startsWith('../');
    }

    private static getCommonWorkspaceFolder(itemsToProcess: ReadonlyArray<vscode.Uri>): vscode.WorkspaceFolder {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(itemsToProcess[0]);
        if (!workspaceFolder) {
            throw new Error('No workspace folder found');
        }

        for (const item of itemsToProcess.slice(1)) {
            const itemWorkspaceFolder = vscode.workspace.getWorkspaceFolder(item);
            if (!itemWorkspaceFolder || itemWorkspaceFolder.uri.toString() !== workspaceFolder.uri.toString()) {
                throw new Error('All selected files and folders must be in the same workspace folder');
            }
        }

        return workspaceFolder;
    }
}

export function activate(context: vscode.ExtensionContext): void {
    const copyToClipboardCommand = vscode.commands.registerCommand(
        'snapsource.copyToClipboard',
        async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
            await Copy4AIService.copyToClipboard(uri, uris);
        }
    );

    const repeatLastCopyCommand = vscode.commands.registerCommand(
        'snapsource.repeatLastCopy',
        async () => {
            await Copy4AIService.repeatLastCopy();
        }
    );

    const copyProjectStructureCommand = vscode.commands.registerCommand(
        'snapsource.copyProjectStructure',
        async (uri?: vscode.Uri) => {
            let targetUri = uri;

            if (!targetUri && (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0)) {
                throw new Error('No workspace open. Please open a workspace to copy project structure.');
            }

            if (!targetUri && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                targetUri = vscode.workspace.workspaceFolders[0].uri;
            }

            await Copy4AIService.copyToClipboard(targetUri, undefined, {
                projectTreeOnly: true
            });
        }
    );

    // The SCM view invokes commands with spread SourceControlResourceState args
    // (vscode's RepositoryPaneActionRunner calls action.run(...args))
    const copyScmResourcesCommand = vscode.commands.registerCommand(
        'snapsource.copyScmResources',
        async (...resourceStates: vscode.SourceControlResourceState[]) => {
            const uris = resourceStates
                .filter(state => state?.resourceUri instanceof vscode.Uri)
                .map(state => state.resourceUri);
            await Copy4AIService.copyToClipboard(undefined, uris);
        }
    );

    const copyScmChangesCommand = vscode.commands.registerCommand(
        'snapsource.copyScmChanges',
        async (...resourceStates: vscode.SourceControlResourceState[]) => {
            const seen = new Set<string>();
            const uris = resourceStates
                .filter(state => state?.resourceUri instanceof vscode.Uri)
                .map(state => state.resourceUri)
                .filter(uri => {
                    const key = uri.toString();
                    if (seen.has(key)) {
                        return false;
                    }
                    seen.add(key);
                    return true;
                });
            await Copy4AIService.copyScmChanges(uris);
        }
    );

    const toggleProjectTreeCommand = vscode.commands.registerCommand(
        'snapsource.toggleProjectTree',
        async () => {
            await ConfigurationService.toggleProjectTree();
        }
    );

    const toggleDotFilesCommand = vscode.commands.registerCommand(
        'snapsource.toggleDotFiles',
        async () => {
            await ConfigurationService.toggleDotFiles();
        }
    );

    context.subscriptions.push(
        copyToClipboardCommand,
        repeatLastCopyCommand,
        copyProjectStructureCommand,
        copyScmResourcesCommand,
        copyScmChangesCommand,
        toggleProjectTreeCommand,
        toggleDotFilesCommand
    );
}

export function deactivate(): void {}

// Public API re-exports (consumed by the test suite)
export { OutputFormatter } from './utils/formatters';
export { FileProcessor } from './utils/fileProcessor';
export { IgnoreUtils } from './utils/ignoreUtils';
export { ConfigurationService } from './utils/configuration';
export { ProjectTreeGenerator } from './utils/projectTree';
export { TokenCounter } from './utils/tokenCounter';
