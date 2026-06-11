import * as vscode from 'vscode';

import { Copy4AIOptions, FileContent, ProcessFileOptions, ProgressReporter, CancellationToken } from './types';
import { ConfigurationService } from './utils/configuration';
import { FileProcessor } from './utils/fileProcessor';
import { ProjectTreeGenerator } from './utils/projectTree';
import { OutputFormatter } from './utils/formatters';
import { IgnoreUtils } from './utils/ignoreUtils';
import { TokenCounter } from './utils/tokenCounter';
import { UriUtils } from './utils/uriUtils';
import { ScmChangesService } from './utils/scmChanges';

export class Copy4AIService {

    // Swappable system boundary: tests replace this with an in-memory clipboard
    // (vscode.env.clipboard is Object.frozen, so it cannot be stubbed in-place)
    public static clipboard: vscode.Clipboard = vscode.env.clipboard;

    public static async copyToClipboard(
        uri?: vscode.Uri,
        uris?: ReadonlyArray<vscode.Uri>,
        options: Readonly<Copy4AIOptions> = {}
    ): Promise<void> {
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Copy4AI: Processing files...",
            cancellable: true
        }, async (progress: ProgressReporter, token: CancellationToken) => {
            try {
                progress.report({ increment: 0, message: "Initializing..." });
                const itemsToProcess = this.resolveItemsToProcess(uri, uris);

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

                let projectRootUri = workspaceFolder.uri;
                let projectRootName = '';

                // Allow using selected folder as root for more focused project views
                // Useful when working with large monorepos or when sharing specific subsections
                if (options.useSelectedFolderAsRoot && itemsToProcess[0]) {
                    const stats = await vscode.workspace.fs.stat(itemsToProcess[0]);
                    if (stats.type & vscode.FileType.Directory) {
                        projectRootUri = itemsToProcess[0];
                        projectRootName = `${UriUtils.basename(projectRootUri)}/`;
                    }
                }

                progress.report({ increment: 15, message: "Generating project tree..." });
                let projectTree = '';
                if (includeProjectTree) {
                    projectTree = await ProjectTreeGenerator.generateProjectTree(
                        projectRootUri,
                        ig,
                        config.maxDepth,
                        0,
                        '',
                        isExcludedByResourcePath,
                        token
                    );

                    if (options.useSelectedFolderAsRoot && projectRootName) {
                        projectTree = projectRootName + '\n' + projectTree;
                    }
                }

                let processedContent: FileContent[] = [];
                const skippedMissingFiles: string[] = [];

                if (!options.projectTreeOnly) {
                    progress.report({ increment: 20, message: "Processing files..." });

                    const processOptions: ProcessFileOptions = {
                        maxFileSize: config.maxFileSize,
                        compressCode: config.compressCode,
                        removeComments: config.removeComments,
                        isExcludedByResourcePath,
                        shouldExcludeContent,
                        cancellationToken: token
                    };

                    const totalItems = itemsToProcess.length;
                    for (let i = 0; i < totalItems; i++) {
                        if (token.isCancellationRequested) {
                            throw new vscode.CancellationError();
                        }

                        const item = itemsToProcess[i];
                        progress.report({
                            increment: 40 / totalItems,
                            message: `Processing ${i+1}/${totalItems}: ${UriUtils.basename(item)}`
                        });

                        // SCM views list deleted files; skip them instead of failing the whole copy
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

                    if (skippedMissingFiles.length === totalItems) {
                        throw new Error(`Selected file(s) no longer exist on disk: ${skippedMissingFiles.join(', ')}`);
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
                    vscode.window.showInformationMessage(`Copied to clipboard: ${config.outputFormat} format`);
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

    public static async copyScmChanges(uris: ReadonlyArray<vscode.Uri>): Promise<void> {
        try {
            if (uris.length === 0) {
                throw new Error('No files selected');
            }

            const api = await ScmChangesService.getGitApi();
            const diff = await ScmChangesService.collectDiffs(api, uris);

            const config = ConfigurationService.getConfiguration(uris[0]);
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
                vscode.window.showInformationMessage(`Copied changes to clipboard: ${config.outputFormat} format`);
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
    ): vscode.Uri[] {
        if (uris && uris.length > 0) {
            return [...uris];
        }
        if (uri) {
            return [uri];
        }

        const activeEditorUri = vscode.window.activeTextEditor?.document.uri;
        return activeEditorUri ? [activeEditorUri] : [];
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
                projectTreeOnly: true,
                useSelectedFolderAsRoot: true
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
export { UriUtils } from './utils/uriUtils';
