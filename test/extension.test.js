const assert = require('assert');
const vscode = require('vscode');
const extension = require('../extension');
const path = require('path');

suite('Copy4AI Extension Test Suite', () => {
    suiteSetup(async () => {
        // This is run once before all tests
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    suiteTeardown(() => {
        // This is run once after all tests
        vscode.window.showInformationMessage('All tests complete!');
    });

    setup(() => {
        // This is run before each test
    });

    teardown(async () => {
        // This is run after each test
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    suite('Extension Basics', () => {
        test('Should register command', async function() {
            this.timeout(10000); // Increase timeout for this test
            
            // Ensure extension is activated
            const ext = vscode.extensions.getExtension('LeonKohli.snapsource');
            if (ext && !ext.isActive) {
                await ext.activate();
            }
            
            // Wait a bit for commands to register
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const commands = await vscode.commands.getCommands();
            assert.ok(commands.includes('snapsource.copyToClipboard'));
        });
    });

    suite('Content Formatting', () => {
        test('Should format content correctly with all formats', async () => {
            // Create test data
            const projectTree = '├── src\n│   └── index.js\n└── package.json\n';
            const content = [
                {
                    path: 'src/index.js',
                    content: 'console.log("Hello World")'
                },
                {
                    path: 'package.json',
                    content: '{"name": "test"}'
                }
            ];

            // Test plaintext format
            const plaintextResult = extension.formatOutput('plaintext', projectTree, content);
            assert.strictEqual(typeof plaintextResult, 'string', 'Plaintext output should be a string');
            assert.ok(plaintextResult.includes('Project Structure:'), 'Should include project structure header');
            assert.ok(plaintextResult.includes('src/index.js'), 'Should include file path');
            assert.ok(plaintextResult.includes('console.log("Hello World")'), 'Should include file content');
            assert.ok(plaintextResult.includes('package.json'), 'Should include file path');
            assert.ok(plaintextResult.includes('{"name": "test"}'), 'Should include file content');

            // Test markdown format
            const markdownResult = extension.formatOutput('markdown', projectTree, content);
            assert.strictEqual(typeof markdownResult, 'string', 'Markdown output should be a string');
            assert.ok(markdownResult.includes('# Project Structure'), 'Should include project structure header');
            assert.ok(markdownResult.includes('```\n' + projectTree + '```'), 'Should include project tree in code block');
            assert.ok(markdownResult.includes('```js\nconsole.log("Hello World")'), 'Should include JS code block');
            assert.ok(markdownResult.includes('```json\n{"name": "test"}'), 'Should include JSON code block');

            // Test XML format
            const xmlResult = extension.formatOutput('xml', projectTree, content);
            assert.strictEqual(typeof xmlResult, 'string', 'XML output should be a string');
            assert.ok(xmlResult.includes('<?xml version="1.0" encoding="UTF-8"?>'), 'Should include XML declaration');
            assert.ok(xmlResult.includes('<project_structure>'), 'Should include project structure tag');
            assert.ok(xmlResult.includes('<file path="src/index.js">'), 'Should include file tag with path');
            assert.ok(xmlResult.includes('<![CDATA[console.log("Hello World")]]>'), 'Should include content in CDATA');
            assert.ok(xmlResult.includes('<file path="package.json">'), 'Should include file tag with path');
            assert.ok(xmlResult.includes('<![CDATA[{"name": "test"}]]>'), 'Should include content in CDATA');
        });

        test('Should handle empty project tree', async () => {
            const content = [{
                path: 'test.txt',
                content: 'test content'
            }];

            // Test with empty project tree
            const plaintextResult = extension.formatOutput('plaintext', '', content);
            assert.ok(!plaintextResult.includes('Project Structure:'), 'Should not include project structure section');
            assert.ok(plaintextResult.includes('File Contents:'), 'Should include file contents header');
            assert.ok(plaintextResult.includes('test content'), 'Should include file content');

            const markdownResult = extension.formatOutput('markdown', '', content);
            assert.ok(!markdownResult.includes('# Project Structure'), 'Should not include project structure section');
            assert.ok(markdownResult.includes('# File Contents'), 'Should include file contents header');
            assert.ok(markdownResult.includes('test content'), 'Should include file content');

            const xmlResult = extension.formatOutput('xml', '', content);
            assert.ok(!xmlResult.includes('<project_structure>'), 'Should not include project structure tag');
            assert.ok(xmlResult.includes('<file_contents>'), 'Should include file contents tag');
            assert.ok(xmlResult.includes('<![CDATA[test content]]>'), 'Should include content in CDATA');
        });

        test('Should handle special characters in XML', async () => {
            const content = [{
                path: 'test & demo.xml',
                content: '<test>Hello & World</test>'
            }];

            const xmlResult = extension.formatOutput('xml', '', content);
            
            // Check path attribute is properly escaped
            assert.ok(xmlResult.includes('path="test &amp; demo.xml"'), 'Should escape special characters in path attribute');
            
            // Check content is wrapped in CDATA
            assert.ok(xmlResult.includes('<![CDATA[<test>Hello & World</test>]]>'), 'Should wrap content in CDATA');
        });

        test('Should handle different file extensions correctly in markdown', async () => {
            const content = [
                {
                    path: 'script.py',
                    content: 'print("Hello")'
                },
                {
                    path: 'style.css',
                    content: 'body { color: red; }'
                },
                {
                    path: 'data.yml',
                    content: 'key: value'
                },
                {
                    path: 'noextension',
                    content: 'plain text'
                }
            ];

            const markdownResult = extension.formatOutput('markdown', '', content);
            
            // Check language-specific code blocks
            assert.ok(markdownResult.includes('```py\nprint("Hello")'), 'Should use py language for Python files');
            assert.ok(markdownResult.includes('```css\nbody { color: red; }'), 'Should use css language for CSS files');
            assert.ok(markdownResult.includes('```yml\nkey: value'), 'Should use yml language for YAML files');
            assert.ok(markdownResult.includes('```\nplain text'), 'Should use no language for files without extension');
        });

        test('Should handle empty content array', async () => {
            const formats = ['plaintext', 'markdown', 'xml'];
            for (const format of formats) {
                const result = extension.formatOutput(format, '', []);
                assert.ok(result.length > 0, `${format} format should handle empty content`);
                assert.ok(!result.includes('undefined'), `${format} format should not contain undefined`);
                assert.ok(typeof result === 'string', `${format} format should return a string`);
            }
        });
    });

    suite('Content Processing', () => {
        test('Should remove comments correctly', () => {
            const testCases = [
                {
                    input: '// Single line comment\nconst x = 1;\n/* Multi\nline\ncomment */\nconst y = 2;',
                    expected: '\nconst x = 1;\n\nconst y = 2;'
                },
                {
                    input: 'const x = 1; // Inline comment\nconst y = 2; /* inline multi */',
                    expected: 'const x = 1; \nconst y = 2; '
                },
                {
                    input: '/* Comment with // nested single line */\ncode();',
                    expected: '\ncode();'
                }
            ];

            testCases.forEach(({ input, expected }) => {
                const result = extension.removeCodeComments(input);
                assert.strictEqual(result, expected, 'Should remove comments correctly');
            });
        });

        test('Should compress code correctly', () => {
            const testCases = [
                {
                    input: '  const x = 1;  \n\n  const y = 2;  \n',
                    expected: 'const x = 1;\nconst y = 2;'
                },
                {
                    input: '\n\n\nconst x = 1;\n\n\n',
                    expected: 'const x = 1;'
                },
                {
                    input: '    if (true) {\n        console.log("test");\n    }    ',
                    expected: 'if (true) {\nconsole.log("test");\n}'
                }
            ];

            testCases.forEach(({ input, expected }) => {
                const result = extension.compressCodeContent(input);
                assert.strictEqual(result, expected, 'Should compress code correctly');
            });
        });

        test('Should handle combined comment removal and compression', () => {
            const input = `
                // Header comment
                function test() {
                    /* Multi-line
                       comment */
                    console.log("test");  // Inline comment
                }
            `;
            
            const expectedAfterCommentRemoval = `
                
                function test() {
                    
                    console.log("test");  
                }
            `;
            
            const expectedFinal = 'function test() {\nconsole.log("test");\n}';
            
            const withoutComments = extension.removeCodeComments(input);
            assert.strictEqual(withoutComments, expectedAfterCommentRemoval, 'Should remove all comments');
            
            const compressed = extension.compressCodeContent(withoutComments);
            assert.strictEqual(compressed, expectedFinal, 'Should compress code after comment removal');
            
            // Test processContent function directly
            const processed = extension.processContent(input, true, true);
            assert.strictEqual(processed, expectedFinal, 'Should process content with both options');
        });
    });

    suite('Command Functionality', () => {
        test('Should respect configuration settings', async function() {
            this.timeout(30000);
            
            // Get the configuration
            const config = vscode.workspace.getConfiguration('copy4ai');
            
            try {
                // Reset settings first to ensure clean state
                await config.update('outputFormat', undefined, vscode.ConfigurationTarget.Global);
                await config.update('maxDepth', undefined, vscode.ConfigurationTarget.Global);
                
                // Wait for settings to be reset
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Update settings
                await config.update('outputFormat', 'markdown', vscode.ConfigurationTarget.Global);
                await config.update('maxDepth', 5, vscode.ConfigurationTarget.Global);
                
                // Wait for settings to be applied
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Get a fresh configuration instance
                const updatedConfig = vscode.workspace.getConfiguration('copy4ai');
                
                // Verify settings
                const format = updatedConfig.get('outputFormat');
                const depth = updatedConfig.get('maxDepth');
                
                assert.strictEqual(format, 'markdown', 'Should update output format setting');
                assert.strictEqual(depth, 5, 'Should update max depth setting');
            } finally {
                // Reset settings in cleanup
                await config.update('outputFormat', undefined, vscode.ConfigurationTarget.Global);
                await config.update('maxDepth', undefined, vscode.ConfigurationTarget.Global);
            }
        });

        test('Should handle binary files correctly', async () => {
            // Ensure testWorkspace directory exists
            const testWorkspacePath = path.join(__dirname, 'testWorkspace');
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(testWorkspacePath));
            
            const testFilePath = path.join(testWorkspacePath, 'test.bin');
            const buffer = Buffer.from([0x89, 0x50, 0x4E, 0x47]); // PNG magic number
            
            // Create a binary file
            await vscode.workspace.fs.writeFile(vscode.Uri.file(testFilePath), buffer);

            try {
                // Open the workspace where the file is located
                await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(testWorkspacePath));
                
                // Wait for workspace to open
                await new Promise(resolve => setTimeout(resolve, 500));
                
                const uri = vscode.Uri.file(testFilePath);
                await vscode.commands.executeCommand('snapsource.copyToClipboard', uri);
                
                const clipboardContent = await vscode.env.clipboard.readText();
                assert.ok(clipboardContent.includes('[Binary file content not included]'), 
                    'Should indicate binary file content is not included');
            } finally {
                // Cleanup
                try {
                    await vscode.workspace.fs.delete(vscode.Uri.file(testFilePath), { recursive: true });
                } catch (error) {
                    console.error(`Error cleaning up binary test file: ${error.message}`);
                }
            }
        });

        test('Should handle large files correctly', async () => {
            // Ensure testWorkspace directory exists
            const testWorkspacePath = path.join(__dirname, 'testWorkspace');
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(testWorkspacePath));
            
            const testFilePath = path.join(testWorkspacePath, 'large.txt');
            const largeContent = 'x'.repeat(2 * 1024 * 1024); // 2MB file
            
            // Create a large file
            await vscode.workspace.fs.writeFile(vscode.Uri.file(testFilePath), Buffer.from(largeContent));

            try {
                // Ensure we're in the right workspace
                if (!vscode.workspace.workspaceFolders || 
                    !vscode.workspace.workspaceFolders[0].uri.fsPath.includes('testWorkspace')) {
                    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(testWorkspacePath));
                    // Wait for workspace to open
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                
                const uri = vscode.Uri.file(testFilePath);
                await vscode.commands.executeCommand('snapsource.copyToClipboard', uri);
                
                const clipboardContent = await vscode.env.clipboard.readText();
                assert.ok(clipboardContent.includes('Size (2097152 bytes) exceeds the maximum allowed size'), 
                    'Should indicate file size exceeds limit');
            } finally {
                // Cleanup
                try {
                    await vscode.workspace.fs.delete(vscode.Uri.file(testFilePath), { recursive: false });
                } catch (error) {
                    console.error(`Error cleaning up large test file: ${error.message}`);
                }
            }
        });

        test('Should handle multiple file selection', async function() {
            this.timeout(10000); // Increase timeout for this test
            
            // Ensure testWorkspace directory exists
            const testWorkspacePath = path.join(__dirname, 'testWorkspace');
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(testWorkspacePath));
            
            const testFiles = [
                { name: 'test1.txt', content: 'Test content 1' },
                { name: 'test2.txt', content: 'Test content 2' }
            ];

            const uris = [];
            try {
                // Create test files concurrently
                await Promise.all(testFiles.map(async (file) => {
                    const filePath = path.join(testWorkspacePath, file.name);
                    await vscode.workspace.fs.writeFile(
                        vscode.Uri.file(filePath),
                        Buffer.from(file.content)
                    );
                    uris.push(vscode.Uri.file(filePath));
                }));

                // Ensure files are written before proceeding
                await new Promise(resolve => setTimeout(resolve, 500));

                // Ensure we're in the right workspace
                if (!vscode.workspace.workspaceFolders || 
                    !vscode.workspace.workspaceFolders[0].uri.fsPath.includes('testWorkspace')) {
                    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(testWorkspacePath));
                    // Wait for workspace to open
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                
                // Test multiple file selection
                await vscode.commands.executeCommand('snapsource.copyToClipboard', uris[0], uris);
                
                // Ensure clipboard is updated before reading
                await new Promise(resolve => setTimeout(resolve, 500));
                
                const clipboardContent = await vscode.env.clipboard.readText();
                assert.ok(clipboardContent.includes('Test content 1'), 'Should include first file content');
                assert.ok(clipboardContent.includes('Test content 2'), 'Should include second file content');
            } finally {
                // Cleanup files concurrently
                try {
                    for (const uri of uris) {
                        await vscode.workspace.fs.delete(uri);
                    }
                } catch (err) {
                    console.error(`Error cleaning up multiple test files: ${err.message}`);
                }
            }
        });
    });
    

    suite('Exclusion Patterns', () => {
        test('Should exclude files using glob patterns', () => {
            // Create an ignore instance with standard patterns
            const ig = extension.createIgnoreInstance(['config', '*.log']);
            
            // Test paths - use platform-agnostic path handling
            const relativePath1 = path.join('src', 'config');
            const relativePath2 = path.join('vendor', 'package', 'config');
            
            // Both should be excluded with the generic pattern
            assert.strictEqual(ig.ignores(relativePath1), true);
            assert.strictEqual(ig.ignores(relativePath2), true);
        });
        
        test('Should exclude specific paths with absolute path exclusion', () => {
            // Create a mock workspace path that's platform-independent
            const workspacePath = path.resolve('/mock/workspace');
            
            // Define absolute paths to exclude with platform-independent path
            const absolutePathsToExclude = [path.join('src', 'config')];
            
            // Create the exclusion function using the helper
            const isExcludedByAbsolutePath = extension.createAbsolutePathExclusionFn(
                workspacePath, 
                absolutePathsToExclude
            );
            
            // Test paths with platform-independent join
            const filePath1 = path.join(workspacePath, 'src', 'config');
            const filePath2 = path.join(workspacePath, 'vendor', 'package', 'config');
            const filePath3 = path.join(workspacePath, 'src', 'config', 'settings.json');
            
            // Verify exclusions
            assert.strictEqual(isExcludedByAbsolutePath(filePath1), true, 'src/config should be excluded');
            assert.strictEqual(isExcludedByAbsolutePath(filePath2), false, 'vendor/package/config should not be excluded');
            assert.strictEqual(isExcludedByAbsolutePath(filePath3), true, 'src/config/settings.json should be excluded');
        });
        
        test('Should handle combined exclusion patterns correctly', () => {
            // Create a mock workspace path with platform-independent path
            const workspacePath = path.resolve('/mock/workspace');
            
            // Create an ignore instance with standard patterns
            const ig = extension.createIgnoreInstance(['*.log', '*.tmp']);
            
            // Create the absolute path exclusion function with platform-independent path
            const isExcludedByAbsolutePath = extension.createAbsolutePathExclusionFn(
                workspacePath, 
                [path.join('src', 'config')]
            );
            
            // Test paths with platform-independent joins
            const paths = [
                { 
                    path: path.join(workspacePath, 'src', 'config', 'app.js'), 
                    expected: true, 
                    message: 'src/config/app.js should be excluded by absolute path' 
                },
                { 
                    path: path.join(workspacePath, 'src', 'utils', 'app.log'), 
                    expected: true, 
                    message: 'src/utils/app.log should be excluded by pattern' 
                },
                { 
                    path: path.join(workspacePath, 'vendor', 'package', 'config', 'app.js'), 
                    expected: false, 
                    message: 'vendor/package/config/app.js should not be excluded' 
                },
                { 
                    path: path.join(workspacePath, 'src', 'app.js'), 
                    expected: false, 
                    message: 'src/app.js should not be excluded' 
                }
            ];
            
            // Test each path
            paths.forEach(testPath => {
                const relativePath = path.relative(workspacePath, testPath.path);
                const isExcluded = ig.ignores(relativePath) || isExcludedByAbsolutePath(testPath.path);
                assert.strictEqual(isExcluded, testPath.expected, testPath.message);
            });
        });

        test('Should respect exclude configuration in workspace settings', async function() {
            this.timeout(10000); // Increase timeout for this test
            
            // Get the test workspace path
            const testWorkspacePath = path.join(__dirname, 'testWorkspace');
            
            try {
                // Open the test workspace
                await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(testWorkspacePath));
                
                // Wait for workspace to open and settings to be loaded
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Get the configuration
                const config = vscode.workspace.getConfiguration('copy4ai');
                const excludeConfig = config.get('exclude');
                
                // Verify the exclude configuration is loaded correctly
                assert.ok(excludeConfig, 'Exclude configuration should be present');
                assert.deepStrictEqual(excludeConfig.paths, ['src/config'], 'Should have correct paths in exclude config');
                assert.deepStrictEqual(excludeConfig.patterns, ['*.log'], 'Should have correct patterns in exclude config');
                
                // Test copying the project structure
                await vscode.commands.executeCommand('snapsource.copyProjectStructure');
                
                // Wait longer for the command to complete and clipboard to update
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                // Get clipboard content
                const clipboardContent = await vscode.env.clipboard.readText();
                
                // For debugging purposes only - can be removed in production
                // console.log('Clipboard content:', clipboardContent);
                
                // Verify src/config is excluded
                const srcConfigIncluded = clipboardContent.includes('src/config/config.js');
                assert.strictEqual(srcConfigIncluded, false, 'src/config/config.js should be excluded');
                
                // Check if src directory is marked as having ignored files
                const srcIgnored = clipboardContent.includes('src') && 
                                  (clipboardContent.includes('(all files ignored)') || 
                                   clipboardContent.includes('(excluded') || 
                                   !clipboardContent.includes('src/config'));
                assert.strictEqual(srcIgnored, true, 'src directory should indicate files are ignored or excluded');
                
                // Verify vendor/package/config is included
                const vendorPathIncluded = clipboardContent.includes('vendor') && 
                                          clipboardContent.includes('package') && 
                                          clipboardContent.includes('config');
                assert.strictEqual(vendorPathIncluded, true, 'vendor/package/config path structure should be included');
            } finally {
                // Return to the original workspace if needed
                // This step might be optional depending on your test setup
            }
        });
        
        test('Should use selected folder as root for project structure', async function() {
            this.timeout(10000); // Increase timeout for this test
            
            // Get the test workspace path
            const testWorkspacePath = path.join(__dirname, 'testWorkspace');
            
            try {
                // Create a test subfolder structure
                const subfolderPath = path.join(testWorkspacePath, 'subfolder');
                const subfileAPath = path.join(subfolderPath, 'fileA.txt');
                const subfileBPath = path.join(subfolderPath, 'fileB.txt');
                
                await vscode.workspace.fs.createDirectory(vscode.Uri.file(subfolderPath));
                await vscode.workspace.fs.writeFile(
                    vscode.Uri.file(subfileAPath), 
                    Buffer.from('Test content A')
                );
                await vscode.workspace.fs.writeFile(
                    vscode.Uri.file(subfileBPath), 
                    Buffer.from('Test content B')
                );
                
                // Open the test workspace
                await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(testWorkspacePath));
                
                // Wait for workspace to open
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Call the copyProjectStructure command with the subfolder URI
                await vscode.commands.executeCommand(
                    'snapsource.copyProjectStructure', 
                    vscode.Uri.file(subfolderPath)
                );
                
                // Wait for the command to complete
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                // Read the clipboard content
                const clipboardContent = await vscode.env.clipboard.readText();
                
                // Verify the clipboard content only includes the subfolder structure
                assert.ok(clipboardContent.includes('subfolder/'), 'Should include subfolder name at the top');
                assert.ok(clipboardContent.includes('fileA.txt'), 'Should include subfolder files');
                assert.ok(clipboardContent.includes('fileB.txt'), 'Should include subfolder files');
                assert.ok(!clipboardContent.includes('src/config'), 'Should not include workspace root files');
                
            } finally {
                // Cleanup
                try {
                    const subfolderPath = path.join(testWorkspacePath, 'subfolder');
                    await vscode.workspace.fs.delete(vscode.Uri.file(subfolderPath), { recursive: true });
                } catch (error) {
                    console.error(`Error cleaning up test subfolder: ${error.message}`);
                }
            }
        });

        test('Should handle encoding issues gracefully and continue processing other files', async function() {
            this.timeout(15000); // Increase timeout for this test
            
            // Get the test workspace path
            const testWorkspacePath = path.join(__dirname, 'testWorkspace');
            
            try {
                // Open the test workspace (it already has UTF-16 LE requirements.txt and other files)
                await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(testWorkspacePath));
                
                // Wait for workspace to open
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Copy the entire test workspace content
                await vscode.commands.executeCommand(
                    'snapsource.copyToClipboard', 
                    vscode.Uri.file(testWorkspacePath)
                );
                
                // Wait for the command to complete
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                // Read the clipboard content
                const clipboardContent = await vscode.env.clipboard.readText();
                

                // Verify that UTF-16 file is handled gracefully
                assert.ok(clipboardContent.includes('requirements.txt'), 'Should include requirements.txt file path');
                assert.ok(clipboardContent.includes('Binary file content not included') || 
                         clipboardContent.includes('unsupported encoding') ||
                         clipboardContent.includes('UTF-16') ||
                         clipboardContent.includes('convert to UTF-8') ||
                         clipboardContent.includes('appears to be UTF-16'), 
                         'Should indicate that requirements.txt content is not included due to encoding/binary detection');
                
                // Verify that other Python files are still processed despite the encoding error
                assert.ok(clipboardContent.includes('starthanders.py'), 'Should include starthanders.py file');
                assert.ok(clipboardContent.includes('urlhandlers.py'), 'Should include urlhandlers.py file');
                assert.ok(clipboardContent.includes('def start_handler'), 'Should include content from starthanders.py');
                assert.ok(clipboardContent.includes('def handle_url'), 'Should include content from urlhandlers.py');
                
                // Verify all files are listed in the project structure, even if content can't be read
                assert.ok(clipboardContent.includes('Project Structure') || 
                         clipboardContent.includes('File Contents'), 
                         'Should include structure/content headers');
                
            } finally {
                // Note: We don't clean up the test files as they're part of the test workspace
            }
        });
    });
});