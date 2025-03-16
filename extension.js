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
            
            // Get exclude settings
            const excludePaths = config.get('excludePaths');
            const excludePatterns = config.get('excludePatterns');
            
            let excludeConfig;
            
            // Use new flat settings if available
            if (Array.isArray(excludePaths) || Array.isArray(excludePatterns)) {
                excludeConfig = {
                    paths: Array.isArray(excludePaths) ? excludePaths : [],
                    patterns: Array.isArray(excludePatterns) ? excludePatterns : ["node_modules", "*.log"]
                };
            } else {
                // Only support the oldest format (excludePatterns array)
                const oldExcludePatterns = config.get('excludePatterns');
                if (oldExcludePatterns) {
                    // Use old format
                    excludeConfig = { 
                        paths: [], 
                        patterns: oldExcludePatterns 
                    };
                } else {
                    // Use defaults if no settings exist
                    excludeConfig = { 
                        paths: [], 
                        patterns: ["node_modules", "*.log"]
                    };
                }
            }
            
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
                    const ig = ignore().add(excludeConfig.patterns || []).add('.*');

                    if (ignoreGitIgnore) {
                        await addGitIgnoreRules(workspaceFolder.uri.fsPath, ig);
                    }

                    // Create a function to check absolute paths (relative to workspace root)
                    const absolutePathsToExclude = excludeConfig.paths || [];
                    const isExcludedByAbsolutePath = createAbsolutePathExclusionFn(workspaceFolder.uri.fsPath, absolutePathsToExclude);

                    // Get project tree if needed
                    progress.report({ increment: 15, message: "Generating project tree..." });
                    let projectTree = includeProjectTree ? 
                        await getProjectTree(workspaceFolder.uri.fsPath, ig, maxDepth, 0, '', isExcludedByAbsolutePath) : '';
                    
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
                                    maxFileSize, compressCode, removeComments, isExcludedByAbsolutePath
                                ));
                            } else {
                                const fileContent = await processFile(
                                    item.fsPath, workspaceFolder.uri.fsPath, ig, 
                                    maxFileSize, compressCode, removeComments, isExcludedByAbsolutePath
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

async function getProjectTree(dir, ig, maxDepth, currentDepth = 0, prefix = '', isExcludedByAbsolutePath) {
    if (currentDepth > maxDepth) return '';
    
    // Check if this directory should be excluded by absolute path
    if (typeof isExcludedByAbsolutePath === 'function' && currentDepth > 0) {
        try {
            if (isExcludedByAbsolutePath(dir)) {
                const relativePath = path.relative(path.dirname(dir), dir);
                return `${prefix}${relativePath} (excluded by path configuration)\n`;
            }
        } catch (error) {
            console.error(`Error checking path exclusion: ${error.message}`);
            // Continue processing if there's an error in exclusion check
        }
    }

    let result = '';
    try {
        const files = await fs.readdir(dir);
        
        if (files.length === 0) {
            return `${prefix}(empty directory)\n`;
        }
        
        // Sort files: directories first, then alphabetically
        const filesWithInfo = [];
        const visibleFiles = [];
        
        // First collect valid files (not ignored)
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const filePath = path.join(dir, file);
            const relativePath = path.relative(dir, filePath);
            
            // Check both ignore patterns and absolute path exclusions
            let isIgnored = false;
            let isExcludedByPath = false;
            
            try {
                isIgnored = ig.ignores(relativePath);
            } catch (error) {
                console.error(`Error checking ignore pattern for ${relativePath}: ${error.message}`);
                // Continue with conservative approach - don't ignore if there's an error
                isIgnored = false;
            }
            
            try {
                isExcludedByPath = typeof isExcludedByAbsolutePath === 'function' && isExcludedByAbsolutePath(filePath);
            } catch (error) {
                console.error(`Error checking path exclusion for ${filePath}: ${error.message}`);
                // Continue with conservative approach - don't exclude if there's an error
                isExcludedByPath = false;
            }
            
            if (!isIgnored && !isExcludedByPath) {
                visibleFiles.push(file);
            }
        }
        
        // If all files are ignored/excluded, show a message
        if (visibleFiles.length === 0) {
            return `${prefix}(all files filtered by exclusion rules)\n`;
        }
        
        // Add file information and sort
        for (let i = 0; i < visibleFiles.length; i++) {
            const file = visibleFiles[i];
            const filePath = path.join(dir, file);
            
            try {
                const stats = await fs.stat(filePath);
                filesWithInfo.push({
                    name: file,
                    isDirectory: stats.isDirectory(),
                    path: filePath
                });
            } catch (error) {
                // Handle specific error for file/directory access
                const errorType = error.code === 'EACCES' ? 'permission denied' : 'access error';
                result += `${prefix}├── ${file} (${errorType})\n`;
            }
        }
        
        // Sort: directories first, then files, both alphabetically
        filesWithInfo.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
        });
        
        // Process the sorted files
        for (let i = 0; i < filesWithInfo.length; i++) {
            const file = filesWithInfo[i].name;
            const filePath = filesWithInfo[i].path;
            const isDirectory = filesWithInfo[i].isDirectory;
            const isLast = i === filesWithInfo.length - 1;
            const branch = isLast ? '└── ' : '├── ';
            
            try {
                result += `${prefix}${branch}${file}\n`;
                
                if (isDirectory) {
                    result += await getProjectTree(filePath, ig, maxDepth, currentDepth + 1, prefix + (isLast ? '    ' : '│   '), isExcludedByAbsolutePath);
                }
            } catch (error) {
                // Handle specific error for file/directory access
                const errorType = error.code === 'EACCES' ? 'permission denied' : 
                                 error.code === 'ENOENT' ? 'not found' : 'access error';
                result += `${prefix}${isLast ? '    ' : '│   '}(${errorType})\n`;
            }
        }
    } catch (error) {
        // Handle different error types with informative messages
        if (error.code === 'EACCES') {
            result = `${prefix}(permission denied)\n`;
        } else if (error.code === 'ENOENT') {
            result = `${prefix}(directory not found)\n`;
        } else {
            result = `${prefix}(error: ${error.message})\n`;
        }
    }
    
    return result;
}

async function processDirectory(dirPath, rootPath, ig, maxFileSize, compressCode, removeComments, isExcludedByAbsolutePath) {
    let content = [];
    try {
        // Check exclusions first for performance optimization
        try {
            const relativePath = path.relative(rootPath, dirPath);
            // Early return if directory should be excluded
            if (ig.ignores(relativePath)) return content;
            if (typeof isExcludedByAbsolutePath === 'function' && isExcludedByAbsolutePath(dirPath)) return content;
        } catch (error) {
            console.error(`Error checking exclusions for directory ${dirPath}: ${error.message}`);
            // Continue processing if exclusion check fails
        }

        const files = await fs.readdir(dirPath);
        for (const file of files) {
            const filePath = path.join(dirPath, file);
            
            try {
                const relativePath = path.relative(rootPath, filePath);
                
                // Check exclusions for each file
                let shouldExclude = false;
                try {
                    shouldExclude = ig.ignores(relativePath) || 
                        (typeof isExcludedByAbsolutePath === 'function' && isExcludedByAbsolutePath(filePath));
                } catch (error) {
                    console.error(`Error checking exclusions for ${filePath}: ${error.message}`);
                    // Default to not excluding if there's an error
                    shouldExclude = false;
                }
                
                if (shouldExclude) continue;
                
                const stats = await fs.stat(filePath);
                if (stats.isDirectory()) {
                    content.push(...await processDirectory(filePath, rootPath, ig, maxFileSize, compressCode, removeComments, isExcludedByAbsolutePath));
                } else {
                    const fileContent = await processFile(filePath, rootPath, ig, maxFileSize, compressCode, removeComments, isExcludedByAbsolutePath);
                    if (fileContent) content.push(fileContent);
                }
            } catch (error) {
                // Log specific error but continue processing other files
                if (error.code === 'ENOENT') {
                    console.error(`File not found: ${filePath}`);
                } else if (error.code === 'EACCES') {
                    console.error(`Permission denied: ${filePath}`);
                } else {
                    console.error(`Error processing file ${filePath}: ${error.message}`);
                }
            }
        }
    } catch (error) {
        console.error(`Error processing directory ${dirPath}: ${error.message}`);
    }
    return content;
}


// Update processFile function to fix compressCodeContent and removeCodeComments calls
async function processFile(filePath, rootPath, ig, maxFileSize, compressCode, removeComments, isExcludedByAbsolutePath) {
    try {
        // Check exclusions first for performance optimization
        try {
            const relativePath = path.relative(rootPath, filePath);
            // Early return if file should be excluded
            if (ig.ignores(relativePath)) return null;
            if (typeof isExcludedByAbsolutePath === 'function' && isExcludedByAbsolutePath(filePath)) return null;
        } catch (error) {
            console.error(`Error checking exclusions for file ${filePath}: ${error.message}`);
            // Continue processing if exclusion check fails
        }

        // Get file stats first
        const stats = await fs.stat(filePath);
        
        // Skip if file is too large
        if (stats.size > maxFileSize) {
            return {
                path: path.relative(rootPath, filePath),
                content: `[File content not included. Size (${stats.size} bytes) exceeds the maximum allowed size (${maxFileSize} bytes)]`
            };
        }
        
        // Check if binary
        try {
            const isBinary = await isBinaryFile(filePath);
            if (isBinary) {
                return {
                    path: path.relative(rootPath, filePath),
                    content: '[Binary file content not included]'
                };
            }
        } catch (error) {
            console.error(`Error checking if file is binary: ${filePath}: ${error.message}`);
        }
        
        try {
            // Read file content
            let content = await fs.readFile(filePath, 'utf8');
            
            // Apply code transformations if needed
            if (compressCode) {
                content = compressCodeContent(content);
            }
            
            if (removeComments) {
                content = removeCodeComments(content);
            }
            
            return {
                path: path.relative(rootPath, filePath),
                content
            };
        } catch (error) {
            // Handle binary files or encoding errors by skipping
            if (error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA') {
                return {
                    path: path.relative(rootPath, filePath),
                    content: '[Binary file content not included]'
                };
            }
            throw error; // Re-throw other errors
        }
    } catch (error) {
        // Log but don't return for error cases
        if (error.code === 'ENOENT') {
            console.error(`File not found: ${filePath}`);
        } else if (error.code === 'EACCES') {
            console.error(`Permission denied: ${filePath}`);
        } else {
            console.error(`Error processing file ${filePath}: ${error.message}`);
        }
        return null;
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
        const filePath = file.path || file.relativePath; // Handle both old and new property names
        const fileExtension = path.extname(filePath).slice(1);
        const language = fileExtension ? fileExtension : '';
        output += `## ${filePath}\n\n\`\`\`${language}\n${file.content}\n\`\`\`\n\n`;
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
        const filePath = file.path || file.relativePath; // Handle both old and new property names
        output += `File: ${filePath}\n\n${file.content}\n\n`;
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
        const filePath = file.path || file.relativePath; // Handle both old and new property names
        output += `    <file path="${escapeXML(filePath)}">\n`;
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

/**
 * Helper function to create an ignore instance with patterns
 * @param {string[]} patterns - Patterns to add to the ignore instance
 * @returns {object} - Configured ignore instance
 */
function createIgnoreInstance(patterns = []) {
    return ignore().add(patterns).add('.*');
}

/**
 * Helper function to create a function that checks if a path should be excluded based on absolute paths
 * @param {string} workspacePath - The workspace root path
 * @param {string[]} absolutePathsToExclude - List of absolute paths (relative to workspace root) to exclude
 * @returns {Function} - Function that checks if a path should be excluded
 */
function createAbsolutePathExclusionFn(workspacePath, absolutePathsToExclude = []) {
    if (!Array.isArray(absolutePathsToExclude) || absolutePathsToExclude.length === 0) {
        // Return a function that always returns false if there are no paths to exclude
        return () => false;
    }

    // Normalize workspace path for consistent comparison
    const normalizedWorkspacePath = path.normalize(workspacePath);
    
    // Normalize all exclude paths upfront for consistent comparison
    const normalizedExcludePaths = absolutePathsToExclude
        .filter(excludePath => typeof excludePath === 'string' && excludePath.trim() !== '')
        .map(excludePath => {
            // Normalize path to current platform standard
            return path.normalize(excludePath.trim());
        });

    // If no valid paths remain after filtering, return a function that always returns false
    if (normalizedExcludePaths.length === 0) {
        return () => false;
    }

    return (filePath) => {
        if (!filePath) {
            return false;
        }

        try {
            // Normalize the file path
            const normalizedFilePath = path.normalize(filePath);
            
            // Get the path relative to workspace
            const relativePath = path.relative(normalizedWorkspacePath, normalizedFilePath);
            const normalizedRelativePath = path.normalize(relativePath);
            
            // Check against each exclude path
            return normalizedExcludePaths.some(excludePath => {
                // Exact match
                if (normalizedRelativePath === excludePath) return true;
                
                // Directory match (should exclude all contents)
                // Make sure we're matching at directory boundaries
                if (normalizedRelativePath.startsWith(excludePath + path.sep)) return true;
                
                // Handle platform-specific case sensitivity issues
                // On Windows, do a case-insensitive comparison as well
                if (process.platform === 'win32') {
                    const lowerRelativePath = normalizedRelativePath.toLowerCase();
                    const lowerExcludePath = excludePath.toLowerCase();
                    
                    if (lowerRelativePath === lowerExcludePath) return true;
                    if (lowerRelativePath.startsWith(lowerExcludePath + path.sep)) return true;
                }
                
                return false;
            });
        } catch (error) {
            // If there's any error in path comparison, don't exclude the file
            console.error(`Error comparing paths: ${error.message}`);
            return false;
        }
    };
}

module.exports = {
    activate,
    deactivate,
    formatOutput,
    formatMarkdown,
    formatPlainText,
    formatXML,
    copyToClipboard,
    getProjectTree,
    processDirectory,
    processFile,
    processContent,
    removeCodeComments,
    compressCodeContent,
    escapeXML,
    createIgnoreInstance,
    createAbsolutePathExclusionFn,
}