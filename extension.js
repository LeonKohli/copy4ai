const vscode = require('vscode');
const fs = require('fs').promises;
const path = require('path');
const ignore = require('ignore').default;
const isBinaryFile = require('isbinaryfile').isBinaryFile;
const { tokenizeAndEstimateCost } = require('llm-cost');

const MODEL_MAX_TOKENS = {
    "gpt-4": 8192,
    "gpt-4o": 128000,
    "gpt-4o-mini": 128000,
    "claude-3-5-sonnet-20240620": 200000,
    "claude-3-opus-20240229": 200000
};

/**
 * Process files, generate content and copy to clipboard
 */
async function copyToClipboard(uri, uris, options = {}) {
    return vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Copy4AI: Processing files...",
        cancellable: true
    }, async (progress, token) => {
        try {
            progress.report({ increment: 0, message: "Initializing..." });
            
            // Get configuration
            const config = vscode.workspace.getConfiguration('copy4ai');
            const ignoreGitIgnore = config.get('ignoreGitIgnore');
            const maxDepth = config.get('maxDepth');
            const excludePatterns = config.get('excludePatterns');
            const outputFormat = config.get('outputFormat');
            const maxFileSize = config.get('maxFileSize') || 1024 * 1024; // Default to 1MB
            const compressCode = config.get('compressCode') || false;
            const removeComments = config.get('removeComments') || false;
            const llmModel = config.get('llmModel') || 'gpt-4';
            const maxTokens = config.get('maxTokens');
            const enableTokenWarning = config.get('enableTokenWarning');
            const enableTokenCounting = config.get('enableTokenCounting') || false;

            // Override any configs with provided options
            const includeProjectTree = options.projectTreeOnly ? true : 
                                       (options.includeProjectTree !== undefined ? 
                                       options.includeProjectTree : 
                                       config.get('includeProjectTree'));

            // Determine items to process
            const itemsToProcess = uris && uris.length > 0 ? uris : [uri];
            
            progress.report({ increment: 10, message: "Setting up file filters..." });

            if (itemsToProcess.length > 0) {
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(itemsToProcess[0]);
                if (workspaceFolder) {
                    const ig = ignore().add(excludePatterns).add('.*');

                    if (ignoreGitIgnore) {
                        await addGitIgnoreRules(workspaceFolder.uri.fsPath, ig);
                    }

                    // Get project tree if needed
                    progress.report({ increment: 15, message: "Generating project tree..." });
                    let projectTree = includeProjectTree ? 
                        await getProjectTree(workspaceFolder.uri.fsPath, ig, maxDepth) : '';
                    
                    let processedContent = [];
                    
                    // For project structure only, skip file processing
                    if (options.projectTreeOnly) {
                        progress.report({ increment: 50, message: "Processing complete" });
                    } else {
                        progress.report({ increment: 20, message: "Processing files..." });
                        
                        // Process each file with progress updates
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
                                processedContent.push(...await processDirectory(
                                    item.fsPath, workspaceFolder.uri.fsPath, ig, 
                                    maxFileSize, compressCode, removeComments
                                ));
                            } else {
                                const fileContent = await processFile(
                                    item.fsPath, workspaceFolder.uri.fsPath, ig, 
                                    maxFileSize, compressCode, removeComments
                                );
                                if (fileContent) processedContent.push(fileContent);
                            }
                        }
                    }

                    // Format the content based on the output format
                    progress.report({ increment: 10, message: "Formatting output..." });
                    
                    let formattedContent;
                    if (options.projectTreeOnly) {
                        // For project structure only, just format the tree without file contents section
                        switch (outputFormat) {
                            case 'markdown':
                                formattedContent = '# Project Structure\n\n```\n' + projectTree + '```\n';
                                break;
                            case 'xml':
                                formattedContent = '<?xml version="1.0" encoding="UTF-8"?>\n<copy4ai>\n' +
                                    '  <project_structure>\n' +
                                    projectTree.split('\n')
                                        .map(line => '    ' + escapeXML(line))
                                        .join('\n') +
                                    '\n  </project_structure>\n</copy4ai>';
                                break;
                            case 'plaintext':
                            default:
                                formattedContent = 'Project Structure:\n\n' + projectTree + '\n';
                                break;
                        }
                    } else {
                        // Normal format with both tree and content
                        formattedContent = formatOutput(
                            outputFormat, 
                            projectTree, 
                            processedContent
                        );
                    }
                    
                    // Copy to clipboard and show token count if enabled
                    if (enableTokenCounting && !options.projectTreeOnly) {
                        progress.report({ increment: 5, message: "Counting tokens..." });
                        
                        const { inputTokens, cost } = await tokenizeAndEstimateCost({
                            model: llmModel,
                            input: formattedContent,
                            output: ''
                        });

                        progress.report({ increment: 5, message: "Copying to clipboard..." });
                        try {
                            await vscode.env.clipboard.writeText(formattedContent);
                            
                            let message = `Copied to clipboard: ${outputFormat} format, ${inputTokens} tokens, $${cost.toFixed(4)} est. cost`;
    
                            if (enableTokenWarning) {
                                const tokenLimit = maxTokens !== null ? maxTokens : (MODEL_MAX_TOKENS[llmModel] || 0);
                                if (tokenLimit > 0 && inputTokens > tokenLimit) {
                                    message += `\nWARNING: Token count (${inputTokens}) exceeds the set limit (${tokenLimit}).`;
                                    vscode.window.showWarningMessage(message, 'OK', 'Reduce Token Count').then(selection => {
                                        if (selection === 'Reduce Token Count') {
                                            vscode.commands.executeCommand('workbench.action.openSettings', 'copy4ai.compressCode');
                                        }
                                    });
                                } else {
                                    vscode.window.showInformationMessage(message);
                                }
                            } else {
                                vscode.window.showInformationMessage(message);
                            }
                        } catch (clipboardError) {
                            console.error('Clipboard error:', clipboardError);
                            vscode.window.showErrorMessage(`Failed to copy to clipboard: ${clipboardError.message}`);
                        }
                    } else {
                        progress.report({ increment: 10, message: "Copying to clipboard..." });
                        try {
                            await vscode.env.clipboard.writeText(formattedContent);
                            
                            const messageText = options.projectTreeOnly ? 
                                `Project structure copied to clipboard: ${outputFormat} format` :
                                `Copied to clipboard: ${outputFormat} format`;
                            
                            vscode.window.showInformationMessage(messageText);
                        } catch (clipboardError) {
                            console.error('Clipboard error:', clipboardError);
                            vscode.window.showErrorMessage(`Failed to copy to clipboard: ${clipboardError.message}`);
                        }
                    }
                } else {
                    throw new Error('Unable to determine workspace folder.');
                }
            } else {
                throw new Error('Please select one or more files or folders in the explorer.');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Error: ${error.message}`);
        }
    });
}

function activate(context) {
    // Register command for copying files and their content to clipboard
    let copyToClipboardCommand = vscode.commands.registerCommand(
        'snapsource.copyToClipboard', 
        async (uri, uris) => copyToClipboard(uri, uris)
    );
    
    // Register command for copying only the project structure
    let copyProjectStructureCommand = vscode.commands.registerCommand(
        'snapsource.copyProjectStructure', 
        async (uri) => {
            try {
                // For project structure, we want to use the workspace root if possible
                let targetUri = uri;
                
                // If no URI was provided or we're not in a workspace, show an error
                if (!uri && (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0)) {
                    throw new Error('No workspace open. Please open a workspace to copy project structure.');
                }
                
                // Use workspace root if available and no URI was provided
                if (!uri && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                    targetUri = vscode.workspace.workspaceFolders[0].uri;
                }
                
                return copyToClipboard(targetUri, null, { 
                    projectTreeOnly: true 
                });
            } catch (error) {
                vscode.window.showErrorMessage(`Error: ${error.message}`);
            }
        }
    );
    
    // Register the toggle project tree command
    let toggleTreeDisposable = vscode.commands.registerCommand(
        'snapsource.toggleProjectTree', 
        async () => {
            try {
                const config = vscode.workspace.getConfiguration('copy4ai');
                const currentValue = config.get('includeProjectTree');
                
                // Toggle the value
                await config.update('includeProjectTree', !currentValue, vscode.ConfigurationTarget.Global);
                
                // Show notification to the user
                const status = !currentValue ? 'enabled' : 'disabled';
                vscode.window.showInformationMessage(`Project tree is now ${status} when copying code.`);
            } catch (error) {
                vscode.window.showErrorMessage(`Error toggling project tree: ${error.message}`);
            }
        }
    );

    // Add commands to subscriptions
    context.subscriptions.push(copyToClipboardCommand);
    context.subscriptions.push(copyProjectStructureCommand);
    context.subscriptions.push(toggleTreeDisposable);
}

async function addGitIgnoreRules(rootPath, ig) {
    const gitIgnorePath = path.join(rootPath, '.gitignore');
    try {
        const gitIgnoreContent = await fs.readFile(gitIgnorePath, 'utf8');
        ig.add(gitIgnoreContent);
    } catch (error) {
        console.log('.gitignore not found or not readable:', error.message);
    }
}

async function getProjectTree(dir, ig, maxDepth, currentDepth = 0, prefix = '') {
    if (currentDepth > maxDepth) return '';

    let result = '';
    try {
        const files = await fs.readdir(dir);
        
        // Handle empty directories
        if (files.length === 0) {
            result += `${prefix}(empty directory)\n`;
            return result;
        }
        
        // Process files and directories
        let visibleFiles = [];
        
        // First collect valid files (not ignored)
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const relativePath = path.relative(dir, path.join(dir, file));
            
            if (!ig.ignores(relativePath)) {
                visibleFiles.push(file);
            }
        }
        
        // If all files are ignored, indicate this
        if (visibleFiles.length === 0) {
            result += `${prefix}(all files ignored)\n`;
            return result;
        }
        
        // Process visible files
        for (let i = 0; i < visibleFiles.length; i++) {
            const file = visibleFiles[i];
            const filePath = path.join(dir, file);
            
            try {
                const stats = await fs.stat(filePath);
                const isLast = i === visibleFiles.length - 1;
                const branch = isLast ? '└── ' : '├── ';
                
                result += `${prefix}${branch}${file}\n`;
                
                if (stats.isDirectory()) {
                    result += await getProjectTree(filePath, ig, maxDepth, currentDepth + 1, prefix + (isLast ? '    ' : '│   '));
                }
            } catch (error) {
                // Handle specific error for file/directory access
                const errorMsg = error.code === 'EACCES' ? '(access denied)' : '(error reading)';
                result += `${prefix}${file} ${errorMsg}\n`;
            }
        }
    } catch (error) {
        console.error(`Error reading directory ${dir}:`, error);
        result += `${prefix}(error: ${error.code || 'unknown'})\n`;
    }
    return result;
}

async function processDirectory(dirPath, rootPath, ig, maxFileSize, compressCode, removeComments) {
    let content = [];
    try {
        const files = await fs.readdir(dirPath);
        for (const file of files) {
            const filePath = path.join(dirPath, file);
            const relativePath = path.relative(rootPath, filePath);
            
            if (ig.ignores(relativePath)) continue;

            const stats = await fs.stat(filePath);
            if (stats.isDirectory()) {
                content.push(...await processDirectory(filePath, rootPath, ig, maxFileSize, compressCode, removeComments));
            } else {
                const fileContent = await processFile(filePath, rootPath, ig, maxFileSize, compressCode, removeComments);
                if (fileContent) content.push(fileContent);
            }
        }
    } catch (error) {
        console.error(`Error processing directory ${dirPath}:`, error);
    }
    return content;
}

async function processFile(filePath, rootPath, ig, maxFileSize, compressCode, removeComments) {
    const relativePath = path.relative(rootPath, filePath);
    if (ig.ignores(relativePath)) return null;

    try {
        // Get file stats first
        const stats = await fs.stat(filePath);

        // Check file size before proceeding
        if (stats.size > maxFileSize) {
            return {
                path: relativePath,
                content: `[File content not included. Size (${stats.size} bytes) exceeds the maximum allowed size (${maxFileSize} bytes)]`
            };
        }

        // Then check if binary
        const isBinary = await isBinaryFile(filePath);
        if (isBinary) {
            return {
                path: relativePath,
                content: '[Binary file content not included]'
            };
        }

        // Read and process file content
        const fileContent = await fs.readFile(filePath, 'utf8');
        let processedContent = fileContent;

        if (removeComments || compressCode) {
            processedContent = processContent(fileContent, removeComments, compressCode);
        }

        return {
            path: relativePath,
            content: processedContent
        };
    } catch (error) {
        // Improved error handling with specific error types
        const errorMessage = error.code === 'ENOENT' ? 'File not found' :
            error.code === 'EACCES' ? 'Permission denied' :
            error.message;
            
        console.error(`Error processing file ${relativePath}:`, error);
        return {
            path: relativePath,
            content: `[Error reading file: ${errorMessage}]`
        };
    }
}

function processContent(content, removeComments, compressCode) {
    if (removeComments) {
        content = removeCodeComments(content);
    }
    
    if (compressCode) {
        content = compressCodeContent(content);
    }
    
    return content;
}

function removeCodeComments(content) {
    return content.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');
}

function compressCodeContent(content) {
    return content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line !== '')
        .join('\n');
}

function formatOutput(format, projectTree, content) {
    switch (format) {
        case 'markdown':
            return formatMarkdown(projectTree, content);
        case 'xml':
            return formatXML(projectTree, content);
        case 'plaintext':
        default:
            return formatPlainText(projectTree, content);
    }
}

function formatMarkdown(projectTree, content) {
    let output = '';
    if (projectTree) {
        output += '# Project Structure\n\n```\n' + projectTree + '```\n\n';
    }
    output += '# File Contents\n\n';
    content.forEach(file => {
        const fileExtension = path.extname(file.path).slice(1);
        const language = fileExtension ? fileExtension : '';
        output += `## ${file.path}\n\n\`\`\`${language}\n${file.content}\n\`\`\`\n\n`;
    });
    return output;
}

function formatPlainText(projectTree, content) {
    let output = '';
    if (projectTree) {
        output += 'Project Structure:\n\n' + projectTree + '\n\n';
    }
    output += 'File Contents:\n\n';
    content.forEach(file => {
        output += `File: ${file.path}\n\n${file.content}\n\n`;
    });
    return output;
}

function formatXML(projectTree, content) {
    let output = '<?xml version="1.0" encoding="UTF-8"?>\n<copy4ai>\n';
    
    if (projectTree) {
        output += '  <project_structure>\n';
        output += projectTree.split('\n')
            .map(line => '    ' + escapeXML(line))
            .join('\n');
        output += '\n  </project_structure>\n\n';
    }
    
    output += '  <file_contents>\n';
    content.forEach(file => {
        output += `    <file path="${escapeXML(file.path)}">\n`;
        const safeContent = file.content.replace(/]]>/g, ']]]]><![CDATA[>');
        output += `      <![CDATA[${safeContent}]]>\n`;
        output += '    </file>\n';
    });
    output += '  </file_contents>\n';
    
    output += '</copy4ai>';
    return output;
}

function escapeXML(unsafe) {
    if (unsafe === null || unsafe === undefined) return '';
    
    // Convert to string if it's not already a string
    const str = String(unsafe);
    
    const xmlEntities = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
        '\u00A0': '&#160;', // non-breaking space
        '\u2028': '&#8232;', // line separator
        '\u2029': '&#8233;'  // paragraph separator
    };

    return str.replace(/[&<>"'\u00A0\u2028\u2029]/g, char => xmlEntities[char]);
}

function deactivate() {}

module.exports = {
    activate,
    deactivate,
    formatOutput,
    formatMarkdown,
    formatPlainText,
    formatXML,
    processContent,
    removeCodeComments,
    compressCodeContent,
    escapeXML
}