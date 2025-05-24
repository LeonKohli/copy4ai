import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

// Import our modular utilities
import { Copy4AIOptions, FileContent, ProcessFileOptions, ProgressReporter, CancellationToken } from './types';
import { ConfigurationService } from './utils/configuration';
import { FileProcessor } from './utils/fileProcessor';
import { ProjectTreeGenerator } from './utils/projectTree';
import { OutputFormatter } from './utils/formatters';
import { IgnoreUtils } from './utils/ignoreUtils';
import { TokenCounter } from './utils/tokenCounter';

export class Copy4AIService {
    
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
                
                // Get configuration
                const config = ConfigurationService.getConfiguration();
                const excludeConfig = ConfigurationService.getExcludeConfig();
                
                // Override configuration with options
                const includeProjectTree = options.projectTreeOnly ? true : 
                                         (options.includeProjectTree !== undefined ? 
                                         options.includeProjectTree : 
                                         config.includeProjectTree);
                
                // Determine items to process
                const itemsToProcess = uris && uris.length > 0 ? uris : (uri ? [uri] : []);
                
                if (itemsToProcess.length === 0) {
                    throw new Error('No files or folders selected');
                }
                
                progress.report({ increment: 10, message: "Setting up file filters..." });
                
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(itemsToProcess[0]);
                if (!workspaceFolder) {
                    throw new Error('No workspace folder found');
                }
                
                // Create ignore instance
                const ig = IgnoreUtils.createIgnoreInstance(excludeConfig.patterns, config.ignoreDotFiles);
                
                if (config.ignoreGitIgnore) {
                    await IgnoreUtils.addGitIgnoreRules(workspaceFolder.uri.fsPath, ig);
                }
                
                // Create absolute path exclusion function
                const isExcludedByAbsolutePath = IgnoreUtils.createAbsolutePathExclusionFn(
                    workspaceFolder.uri.fsPath,
                    excludeConfig.paths
                );
                
                // Determine project root
                let projectRootPath = workspaceFolder.uri.fsPath;
                let projectRootName = '';
                
                if (options.useSelectedFolderAsRoot && itemsToProcess[0]) {
                    try {
                        const stats = await fs.stat(itemsToProcess[0].fsPath);
                        if (stats.isDirectory()) {
                            projectRootPath = itemsToProcess[0].fsPath;
                            projectRootName = path.basename(projectRootPath) + '/';
                        }
                    } catch (error) {
                        console.error('Error using selected folder as root:', error);
                    }
                }
                
                // Generate project tree
                progress.report({ increment: 15, message: "Generating project tree..." });
                let projectTree = '';
                if (includeProjectTree) {
                    projectTree = await ProjectTreeGenerator.generateProjectTree(
                        projectRootPath,
                        ig,
                        config.maxDepth,
                        0,
                        '',
                        isExcludedByAbsolutePath
                    );
                    
                    if (options.useSelectedFolderAsRoot && projectRootName) {
                        projectTree = projectRootName + '\n' + projectTree;
                    }
                }
                
                let processedContent: FileContent[] = [];
                
                // Process files if not project tree only
                if (!options.projectTreeOnly) {
                    progress.report({ increment: 20, message: "Processing files..." });
                    
                    const processOptions: ProcessFileOptions = {
                        maxFileSize: config.maxFileSize,
                        compressCode: config.compressCode,
                        removeComments: config.removeComments,
                        isExcludedByAbsolutePath
                    };
                    
                    const totalItems = itemsToProcess.length;
                    for (let i = 0; i < totalItems; i++) {
                        if (token.isCancellationRequested) {
                            throw new Error('Operation cancelled');
                        }
                        
                        const item = itemsToProcess[i];
                        const progressPercent = Math.floor(20 + ((i / totalItems) * 40));
                        progress.report({ 
                            increment: progressPercent / totalItems, 
                            message: `Processing ${i+1}/${totalItems}: ${path.basename(item.fsPath)}` 
                        });
                        
                        const stats = await fs.stat(item.fsPath);
                        if (stats.isDirectory()) {
                            const dirResults = await FileProcessor.processDirectory(
                                item.fsPath,
                                workspaceFolder.uri.fsPath,
                                ig,
                                processOptions
                            );
                            processedContent.push(...dirResults);
                        } else {
                            const fileContent = await FileProcessor.processFile(
                                item.fsPath,
                                workspaceFolder.uri.fsPath,
                                ig,
                                processOptions
                            );
                            if (fileContent) {
                                processedContent.push(fileContent);
                            }
                        }
                    }
                }
                
                // Format output
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
                
                // Copy to clipboard
                progress.report({ increment: 5, message: "Copying to clipboard..." });
                await vscode.env.clipboard.writeText(formattedContent);
                
                // Show token count if enabled
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
                
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Copy4AI Error: ${errorMessage}`);
                throw error;
            }
        });
    }
}

export function activate(context: vscode.ExtensionContext): void {
    // Register copy to clipboard command
    const copyToClipboardCommand = vscode.commands.registerCommand(
        'snapsource.copyToClipboard',
        async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
            try {
                await Copy4AIService.copyToClipboard(uri, uris);
            } catch (error) {
                // Error already handled in the service
            }
        }
    );
    
    // Register copy project structure command
    const copyProjectStructureCommand = vscode.commands.registerCommand(
        'snapsource.copyProjectStructure',
        async (uri?: vscode.Uri) => {
            try {
                let targetUri = uri;
                
                // Validate workspace
                if (!targetUri && (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0)) {
                    throw new Error('No workspace open. Please open a workspace to copy project structure.');
                }
                
                // Use workspace root if no URI provided
                if (!targetUri && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                    targetUri = vscode.workspace.workspaceFolders[0].uri;
                }
                
                await Copy4AIService.copyToClipboard(targetUri, undefined, {
                    projectTreeOnly: true,
                    useSelectedFolderAsRoot: true
                });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Error: ${errorMessage}`);
            }
        }
    );
    
    // Register toggle project tree command
    const toggleProjectTreeCommand = vscode.commands.registerCommand(
        'snapsource.toggleProjectTree',
        async () => {
            try {
                await ConfigurationService.toggleProjectTree();
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Error toggling project tree: ${errorMessage}`);
            }
        }
    );
    
    // Register toggle dot files command
    const toggleDotFilesCommand = vscode.commands.registerCommand(
        'snapsource.toggleDotFiles',
        async () => {
            try {
                await ConfigurationService.toggleDotFiles();
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Error toggling dot files setting: ${errorMessage}`);
            }
        }
    );
    
    // Add commands to subscriptions
    context.subscriptions.push(
        copyToClipboardCommand,
        copyProjectStructureCommand,
        toggleProjectTreeCommand,
        toggleDotFilesCommand
    );
}

export function deactivate(): void {
    // Cleanup if needed
}

// Export modern API for testing and external use
export { OutputFormatter } from './utils/formatters';
export { FileProcessor } from './utils/fileProcessor';
export { IgnoreUtils } from './utils/ignoreUtils';
export { ConfigurationService } from './utils/configuration';
export { ProjectTreeGenerator } from './utils/projectTree';
export { TokenCounter } from './utils/tokenCounter'; 