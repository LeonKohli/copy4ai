const assert = require('assert');
const vscode = require('vscode');
const {
    OutputFormatter,
    FileProcessor,
    IgnoreUtils,
    ConfigurationService,
    ProjectTreeGenerator,
    TokenCounter,
    Copy4AIService
} = require('../out/extension');
const path = require('path');

// In-memory stand-in for vscode.env.clipboard so test runs don't spam the OS
// clipboard (and clipboard-manager history). vscode.env.clipboard itself is
// Object.frozen and cannot be stubbed; Copy4AIService.clipboard is the seam.
const testClipboard = {
    text: '',
    async readText() { return this.text; },
    async writeText(value) { this.text = value; }
};

class MemoryFileSystemProvider {
    constructor(files) {
        this.emitter = new vscode.EventEmitter();
        this.onDidChangeFile = this.emitter.event;
        this.files = new Map();
        this.directories = new Set(['/']);

        for (const [filePath, content] of files) {
            const normalizedPath = this.normalizePath(filePath);
            this.files.set(normalizedPath, Buffer.from(content));
            this.addParentDirectories(normalizedPath);
        }
    }

    watch() {
        return new vscode.Disposable(() => {});
    }

    stat(uri) {
        const key = this.normalizePath(uri.path);
        if (this.directories.has(key)) {
            return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
        }

        const file = this.files.get(key);
        if (file) {
            return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: file.byteLength };
        }

        throw vscode.FileSystemError.FileNotFound(uri);
    }

    readDirectory(uri) {
        const directoryPath = this.normalizePath(uri.path);
        const entries = new Map();

        for (const candidate of this.directories) {
            if (candidate === directoryPath) {
                continue;
            }

            if (this.parentPath(candidate) === directoryPath) {
                entries.set(path.posix.basename(candidate), vscode.FileType.Directory);
            }
        }

        for (const candidate of this.files.keys()) {
            if (this.parentPath(candidate) === directoryPath) {
                entries.set(path.posix.basename(candidate), vscode.FileType.File);
            }
        }

        if (entries.size === 0 && !this.directories.has(directoryPath)) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        return Array.from(entries.entries());
    }

    readFile(uri) {
        const file = this.files.get(this.normalizePath(uri.path));
        if (!file) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        return file;
    }

    createDirectory() {
        throw vscode.FileSystemError.NoPermissions();
    }

    writeFile() {
        throw vscode.FileSystemError.NoPermissions();
    }

    delete() {
        throw vscode.FileSystemError.NoPermissions();
    }

    rename() {
        throw vscode.FileSystemError.NoPermissions();
    }

    normalizePath(filePath) {
        const normalized = path.posix.normalize(filePath);
        return normalized.startsWith('/') ? normalized : `/${normalized}`;
    }

    addParentDirectories(filePath) {
        let current = this.parentPath(filePath);
        while (current !== '/') {
            this.directories.add(current);
            current = this.parentPath(current);
        }
    }

    parentPath(filePath) {
        const parent = path.posix.dirname(filePath);
        return parent === '.' ? '/' : parent;
    }
}

suite('Copy4AI Extension Test Suite', () => {
    suiteSetup(async () => {
        // This is run once before all tests
        Copy4AIService.clipboard = testClipboard;
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    suiteTeardown(() => {
        // This is run once after all tests
        vscode.window.showInformationMessage('All tests complete!');
    });

    setup(() => {
        // Isolate tests from each other's clipboard writes
        testClipboard.text = '';
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
            const plaintextResult = OutputFormatter.formatOutput('plaintext', projectTree, content);
            assert.strictEqual(typeof plaintextResult, 'string', 'Plaintext output should be a string');
            assert.ok(plaintextResult.includes('Project Structure:'), 'Should include project structure header');
            assert.ok(plaintextResult.includes('src/index.js'), 'Should include file path');
            assert.ok(plaintextResult.includes('console.log("Hello World")'), 'Should include file content');
            assert.ok(plaintextResult.includes('package.json'), 'Should include file path');
            assert.ok(plaintextResult.includes('{"name": "test"}'), 'Should include file content');

            // Test markdown format
            const markdownResult = OutputFormatter.formatOutput('markdown', projectTree, content);
            assert.strictEqual(typeof markdownResult, 'string', 'Markdown output should be a string');
            assert.ok(markdownResult.includes('# Project Structure'), 'Should include project structure header');
            assert.ok(markdownResult.includes('```\n' + projectTree + '```'), 'Should include project tree in code block');
            assert.ok(markdownResult.includes('```javascript\nconsole.log("Hello World")'), 'Should include JavaScript code block');
            assert.ok(markdownResult.includes('```json\n{"name": "test"}'), 'Should include JSON code block');

            // Test XML format
            const xmlResult = OutputFormatter.formatOutput('xml', projectTree, content);
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
            const plaintextResult = OutputFormatter.formatOutput('plaintext', '', content);
            assert.ok(!plaintextResult.includes('Project Structure:'), 'Should not include project structure section');
            assert.ok(plaintextResult.includes('File Contents:'), 'Should include file contents header');
            assert.ok(plaintextResult.includes('test content'), 'Should include file content');

            const markdownResult = OutputFormatter.formatOutput('markdown', '', content);
            assert.ok(!markdownResult.includes('# Project Structure'), 'Should not include project structure section');
            assert.ok(markdownResult.includes('# File Contents'), 'Should include file contents header');
            assert.ok(markdownResult.includes('test content'), 'Should include file content');

            const xmlResult = OutputFormatter.formatOutput('xml', '', content);
            assert.ok(!xmlResult.includes('<project_structure>'), 'Should not include project structure tag');
            assert.ok(xmlResult.includes('<file_contents>'), 'Should include file contents tag');
            assert.ok(xmlResult.includes('<![CDATA[test content]]>'), 'Should include content in CDATA');
        });

        test('Should handle special characters in XML', async () => {
            const content = [{
                path: 'test & demo.xml',
                content: '<test>Hello & World</test>'
            }];

            const xmlResult = OutputFormatter.formatOutput('xml', '', content);
            
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

            const markdownResult = OutputFormatter.formatOutput('markdown', '', content);
            
            // Check language-specific code blocks
            assert.ok(markdownResult.includes('```python\nprint("Hello")'), 'Should use python language for Python files');
            assert.ok(markdownResult.includes('```css\nbody { color: red; }'), 'Should use css language for CSS files');
            assert.ok(markdownResult.includes('```yaml\nkey: value'), 'Should use yaml language for YAML files');
            assert.ok(markdownResult.includes('```\nplain text'), 'Should use no language for files without extension');
        });

        test('Should handle empty content array', async () => {
            // Test plaintext and markdown formats (should return empty)
            const emptyFormats = ['plaintext', 'markdown'];
            for (const format of emptyFormats) {
                const result = OutputFormatter.formatOutput(format, '', []);
                assert.ok(typeof result === 'string', `${format} format should return a string`);
                assert.ok(!result.includes('undefined'), `${format} format should not contain undefined`);
                assert.strictEqual(result, '', `${format} format should return empty string for empty content and tree`);
            }
            
            // Test XML format (returns basic XML structure even when empty)
            const xmlResult = OutputFormatter.formatOutput('xml', '', []);
            assert.ok(typeof xmlResult === 'string', 'XML format should return a string');
            assert.ok(!xmlResult.includes('undefined'), 'XML format should not contain undefined');
            assert.ok(xmlResult.includes('<?xml version="1.0" encoding="UTF-8"?>'), 'XML should include declaration');
            assert.ok(xmlResult.includes('<copy4ai>'), 'XML should include root element');
            assert.ok(xmlResult.includes('</copy4ai>'), 'XML should close root element');
        });

        test('Should handle nested markdown code blocks (Issue #16)', async () => {
            const markdownFileContent = '# Installation\n\n```sh\nnpm i -S my-project\n```\n\nGood luck!';
            const content = [{
                path: 'README.md',
                content: markdownFileContent
            }];

            const result = OutputFormatter.formatOutput('markdown', '', content);
            
            assert.ok(result.includes('````markdown'), 'Should use 4 backticks for outer fence when content has 3');
            assert.ok(result.includes('```sh'), 'Inner code block should remain unchanged');
            assert.ok(result.includes('npm i -S my-project'), 'Content should be preserved');
            
            const outerFenceCount = (result.match(/````/g) || []).length;
            assert.strictEqual(outerFenceCount, 2, 'Should have exactly 2 quadruple-backtick fences (open and close)');
        });

        test('Should handle deeply nested markdown code blocks', async () => {
            const deeplyNestedContent = '# Demo\n\n````md\n```js\nconsole.log("hi");\n```\n````';
            const content = [{
                path: 'nested.md',
                content: deeplyNestedContent
            }];

            const result = OutputFormatter.formatOutput('markdown', '', content);
            
            assert.ok(result.includes('`````markdown'), 'Should use 5 backticks when content has 4');
        });

        test('getMarkdownFence should return correct fence length', () => {
            assert.strictEqual(OutputFormatter.getMarkdownFence('plain text'), '```');
            assert.strictEqual(OutputFormatter.getMarkdownFence('```js\ncode\n```'), '````');
            assert.strictEqual(OutputFormatter.getMarkdownFence('````md\n```\n````'), '`````');
            assert.strictEqual(OutputFormatter.getMarkdownFence('Use `code` or ``double``'), '```');
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
                const result = FileProcessor.removeCodeComments(input);
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
                const result = FileProcessor.compressCodeContent(input);
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
            
            const withoutComments = FileProcessor.removeCodeComments(input);
            assert.strictEqual(withoutComments, expectedAfterCommentRemoval, 'Should remove all comments');
            
            const compressed = FileProcessor.compressCodeContent(withoutComments);
            assert.strictEqual(compressed, expectedFinal, 'Should compress code after comment removal');
            
            // Test processContent function directly
            const processed = FileProcessor.processContent(input, true, true);
            assert.strictEqual(processed, expectedFinal, 'Should process content with both options');
        });
    });

    suite('Token Counting', () => {
        test('Should select offline tokenizer by model family', () => {
            const openAiInfo = TokenCounter.countTokens('hello world', 'gpt-5.5');
            assert.strictEqual(openAiInfo.method, 'openai-o200k');
            assert.strictEqual(openAiInfo.approximate, false);
            assert.ok(openAiInfo.inputTokens > 0, 'OpenAI token count should be positive');
            assert.ok(openAiInfo.maxInputTokens > 0, 'Known OpenAI model should have context limit');

            const claudeInfo = TokenCounter.countTokens('hello world', 'claude-sonnet-4-6');
            assert.strictEqual(claudeInfo.method, 'anthropic-legacy');
            assert.strictEqual(claudeInfo.approximate, true);
            assert.ok(claudeInfo.inputTokens > 0, 'Claude token count should be positive');

            const unknownInfo = TokenCounter.countTokens('hello world', 'new-provider-model');
            assert.strictEqual(unknownInfo.method, 'chars-heuristic');
            assert.strictEqual(unknownInfo.approximate, true);
            assert.strictEqual(unknownInfo.maxInputTokens, null);
        });

        test('Should resolve dated/suffixed model names via prefix lookup', () => {
            const datedOpus = TokenCounter.countTokens('hi', 'claude-opus-4-7-20260416');
            assert.strictEqual(datedOpus.method, 'anthropic-legacy');
            assert.strictEqual(datedOpus.maxInputTokens, 1000000, 'Dated Opus 4.7 should resolve to 1M context');

            const codexVariant = TokenCounter.countTokens('hi', 'gpt-5-codex-2026-01-01');
            assert.strictEqual(codexVariant.method, 'openai-o200k');
            assert.strictEqual(codexVariant.maxInputTokens, 400000);
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
                
                
                // Update settings
                await config.update('outputFormat', 'markdown', vscode.ConfigurationTarget.Global);
                await config.update('maxDepth', 5, vscode.ConfigurationTarget.Global);
                
                
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
                
                
                const uri = vscode.Uri.file(testFilePath);
                await vscode.commands.executeCommand('snapsource.copyToClipboard', uri);
                
                const clipboardContent = await testClipboard.readText();
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
                }
                
                const uri = vscode.Uri.file(testFilePath);
                await vscode.commands.executeCommand('snapsource.copyToClipboard', uri);
                
                const clipboardContent = await testClipboard.readText();
                assert.ok(clipboardContent.includes('[File too large:') && clipboardContent.includes('2.0 MB'), 
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


                // Ensure we're in the right workspace
                if (!vscode.workspace.workspaceFolders || 
                    !vscode.workspace.workspaceFolders[0].uri.fsPath.includes('testWorkspace')) {
                    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(testWorkspacePath));
                }
                
                // Test multiple file selection
                await vscode.commands.executeCommand('snapsource.copyToClipboard', uris[0], uris);
                
                
                const clipboardContent = await testClipboard.readText();
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

        test('Should copy active editor file when invoked without URI arguments', async function() {
            this.timeout(10000);

            const testWorkspacePath = path.join(__dirname, 'testWorkspace');
            if (!vscode.workspace.workspaceFolders ||
                !vscode.workspace.workspaceFolders[0].uri.fsPath.includes('testWorkspace')) {
                await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(testWorkspacePath));
            }

            const uri = vscode.Uri.file(path.join(testWorkspacePath, 'app.js'));
            const document = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(document);

            await vscode.commands.executeCommand('snapsource.copyToClipboard');

            const clipboardContent = await testClipboard.readText();
            assert.ok(clipboardContent.includes('app.js'), 'Should include active editor file path');
            assert.ok(
                clipboardContent.includes("console.log('Hello from the test workspace!');"),
                'Should include active editor file content'
            );
        });
    });
    

    suite('Workspace Trust Manifest', () => {
        // A real untrusted-workspace integration test is not possible:
        // @vscode/test-electron hardcodes --disable-workspace-trust (runTest.ts),
        // so workspace.isTrusted is always true under the test runner.
        // This guards the declarative contract instead: a newly added setting
        // must not silently become workspace-configurable in Restricted Mode.
        test('Every contributed setting is listed in restrictedConfigurations', () => {
            const manifest = require('../package.json');

            const contributed = manifest.contributes.configuration
                .flatMap(section => Object.keys(section.properties));
            const restricted = manifest.capabilities.untrustedWorkspaces.restrictedConfigurations;

            assert.deepStrictEqual(
                [...contributed].sort(),
                [...restricted].sort(),
                'contributes.configuration and untrustedWorkspaces.restrictedConfigurations must list the same settings'
            );
        });
    });

    suite('SCM Integration', () => {
        const testWorkspacePath = path.join(__dirname, 'testWorkspace');

        async function ensureTestWorkspace() {
            if (!vscode.workspace.workspaceFolders ||
                !vscode.workspace.workspaceFolders[0].uri.fsPath.includes('testWorkspace')) {
                await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(testWorkspacePath));
            }
        }

        test('Should register SCM copy command', async function() {
            this.timeout(10000);

            const ext = vscode.extensions.getExtension('LeonKohli.snapsource');
            if (ext && !ext.isActive) {
                await ext.activate();
            }

            const commands = await vscode.commands.getCommands();
            assert.ok(commands.includes('snapsource.copyScmResources'), 'Should register snapsource.copyScmResources');
        });

        test('Should copy files passed as spread SCM resource states', async function() {
            this.timeout(10000);
            await ensureTestWorkspace();

            const testFiles = [
                { name: 'scm-test1.txt', content: 'SCM content one' },
                { name: 'scm-test2.txt', content: 'SCM content two' }
            ];
            const uris = [];

            try {
                for (const file of testFiles) {
                    const uri = vscode.Uri.file(path.join(testWorkspacePath, file.name));
                    await vscode.workspace.fs.writeFile(uri, Buffer.from(file.content));
                    uris.push(uri);
                }

                // The SCM view invokes commands with spread SourceControlResourceState
                // args (see RepositoryPaneActionRunner in vscode); duck-typed objects
                // exercise the same code path.
                await vscode.commands.executeCommand(
                    'snapsource.copyScmResources',
                    { resourceUri: uris[0] },
                    { resourceUri: uris[1] }
                );

                const clipboardContent = await testClipboard.readText();
                assert.ok(clipboardContent.includes('SCM content one'), 'Should include first resource content');
                assert.ok(clipboardContent.includes('SCM content two'), 'Should include second resource content');
            } finally {
                for (const uri of uris) {
                    try {
                        await vscode.workspace.fs.delete(uri);
                    } catch (error) {
                        console.error(`Error cleaning up SCM test file: ${error.message}`);
                    }
                }
            }
        });

        test('Should skip deleted files in SCM selection and copy the rest', async function() {
            this.timeout(10000);
            await ensureTestWorkspace();

            const existingUri = vscode.Uri.file(path.join(testWorkspacePath, 'scm-existing.txt'));
            const deletedUri = vscode.Uri.file(path.join(testWorkspacePath, 'scm-deleted.txt'));

            try {
                await vscode.workspace.fs.writeFile(existingUri, Buffer.from('Still on disk'));

                await vscode.commands.executeCommand(
                    'snapsource.copyScmResources',
                    { resourceUri: existingUri },
                    { resourceUri: deletedUri }
                );

                const clipboardContent = await testClipboard.readText();
                assert.ok(clipboardContent.includes('Still on disk'), 'Should include the existing file content');
                assert.ok(!clipboardContent.includes('scm-deleted.txt'), 'Should not list the deleted file');
            } finally {
                try {
                    await vscode.workspace.fs.delete(existingUri);
                } catch (error) {
                    console.error(`Error cleaning up SCM test file: ${error.message}`);
                }
            }
        });

        test('Should fail without touching the clipboard when all selected files are deleted', async function() {
            this.timeout(10000);
            await ensureTestWorkspace();

            const deletedUri = vscode.Uri.file(path.join(testWorkspacePath, 'scm-gone.txt'));
            const sentinel = 'clipboard-sentinel-' + Math.random();
            await testClipboard.writeText(sentinel);

            await assert.rejects(
                Promise.resolve(vscode.commands.executeCommand(
                    'snapsource.copyScmResources',
                    { resourceUri: deletedUri }
                )),
                /no longer exist/,
                'Should reject because the selected file does not exist on disk'
            );

            const clipboardContent = await testClipboard.readText();
            assert.strictEqual(clipboardContent, sentinel, 'Clipboard should be unchanged');
        });
    });

    suite('Exclusion Patterns', () => {
        test('Should exclude files using glob patterns', () => {
            // Create an ignore instance with standard patterns
            const ig = IgnoreUtils.createIgnoreInstance(['config', '*.log']);
            
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
            const isExcludedByAbsolutePath = IgnoreUtils.createAbsolutePathExclusionFn(
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
        
        test('Should respect trailing-slash directory patterns (issue #21)', () => {
            // Patterns ending with `/` (e.g. `build/`) should match directories.
            // The `ignore` library requires the checked path to end with `/` for these to match.
            // IgnoreUtils.isIgnored handles this when isDirectory=true is passed.
            const ig = IgnoreUtils.createIgnoreInstance(['src-tauri/icons/', 'build/', 'dist/']);

            // Directory checks: should be excluded
            assert.strictEqual(IgnoreUtils.isIgnored(ig, path.join('src-tauri', 'icons'), true), true,
                'src-tauri/icons directory should be ignored by `src-tauri/icons/` pattern');
            assert.strictEqual(IgnoreUtils.isIgnored(ig, 'build', true), true,
                'build directory should be ignored by `build/` pattern');
            assert.strictEqual(IgnoreUtils.isIgnored(ig, path.join('packages', 'app', 'dist'), true), true,
                'nested dist directory should be ignored (unanchored pattern)');

            // Files inside the directory should also be excluded
            assert.strictEqual(IgnoreUtils.isIgnored(ig, path.join('src-tauri', 'icons', 'logo.png'), false), true,
                'file inside src-tauri/icons should be ignored');

            // Same-named file (not dir) should NOT be ignored — `foo/` only matches directories
            assert.strictEqual(IgnoreUtils.isIgnored(ig, 'build', false), false,
                'a file named `build` should not match the `build/` directory-only pattern');

            // Similarly-named directories should not match
            assert.strictEqual(IgnoreUtils.isIgnored(ig, 'build-tools', true), false,
                'build-tools should not match `build/` pattern');
        });

        test('Should treat patterns without trailing slash as matching both files and dirs', () => {
            const ig = IgnoreUtils.createIgnoreInstance(['node_modules', '*.log']);

            assert.strictEqual(IgnoreUtils.isIgnored(ig, 'node_modules', true), true,
                'node_modules dir should be ignored');
            assert.strictEqual(IgnoreUtils.isIgnored(ig, 'node_modules', false), true,
                'file named node_modules should also be ignored (pattern has no trailing slash)');
            assert.strictEqual(IgnoreUtils.isIgnored(ig, 'app.log', false), true,
                '*.log file should be ignored');
            assert.strictEqual(IgnoreUtils.isIgnored(ig, '', true), false,
                'empty relative path should not be ignored');
        });

        test('Should handle combined exclusion patterns correctly', () => {
            // Create a mock workspace path with platform-independent path
            const workspacePath = path.resolve('/mock/workspace');
            
            // Create an ignore instance with standard patterns
            const ig = IgnoreUtils.createIgnoreInstance(['*.log', '*.tmp']);
            
            // Create the absolute path exclusion function with platform-independent path
            const isExcludedByAbsolutePath = IgnoreUtils.createAbsolutePathExclusionFn(
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
                
                
                // Get the configuration
                const config = vscode.workspace.getConfiguration('copy4ai');
                const excludeConfig = config.get('exclude');
                
                // Verify the exclude configuration is loaded correctly
                assert.ok(excludeConfig, 'Exclude configuration should be present');
                assert.deepStrictEqual(excludeConfig.paths, ['src/config'], 'Should have correct paths in exclude config');
                assert.deepStrictEqual(excludeConfig.patterns, ['*.log'], 'Should have correct patterns in exclude config');
                
                // Test copying the project structure
                await vscode.commands.executeCommand('snapsource.copyProjectStructure');
                
                
                // Get clipboard content
                const clipboardContent = await testClipboard.readText();
                
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
                
                
                // Call the copyProjectStructure command with the subfolder URI
                await vscode.commands.executeCommand(
                    'snapsource.copyProjectStructure', 
                    vscode.Uri.file(subfolderPath)
                );
                
                
                // Read the clipboard content
                const clipboardContent = await testClipboard.readText();
                
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
                
                
                // Copy the entire test workspace content
                await vscode.commands.executeCommand(
                    'snapsource.copyToClipboard', 
                    vscode.Uri.file(testWorkspacePath)
                );
                
                
                // Read the clipboard content
                const clipboardContent = await testClipboard.readText();
                

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

        test('createContentExclusionFn should match files by glob pattern', () => {
            const workspacePath = path.resolve('/mock/workspace');
            
            const shouldExcludeContent = IgnoreUtils.createContentExclusionFn(
                workspacePath,
                ['**/*.svg', '**/*.png', 'assets/**']
            );
            
            const testCases = [
                { file: path.join(workspacePath, 'icon.svg'), expected: true },
                { file: path.join(workspacePath, 'images', 'logo.png'), expected: true },
                { file: path.join(workspacePath, 'assets', 'data.json'), expected: true },
                { file: path.join(workspacePath, 'src', 'app.js'), expected: false },
                { file: path.join(workspacePath, 'README.md'), expected: false },
            ];
            
            testCases.forEach(tc => {
                const result = shouldExcludeContent(tc.file);
                assert.strictEqual(result, tc.expected, 
                    `${tc.file} should ${tc.expected ? 'be excluded' : 'not be excluded'}`);
            });
        });

        test('createContentExclusionFn should return false when patterns empty', () => {
            const workspacePath = path.resolve('/mock/workspace');
            const shouldExcludeContent = IgnoreUtils.createContentExclusionFn(workspacePath, []);
            
            assert.strictEqual(shouldExcludeContent(path.join(workspacePath, 'any.svg')), false);
            assert.strictEqual(shouldExcludeContent(path.join(workspacePath, 'file.png')), false);
        });

        test('Should process virtual file system resources through VS Code workspace.fs', async () => {
            const provider = new MemoryFileSystemProvider([
                ['/project/.gitignore', 'ignored.txt\n'],
                ['/project/src/app.ts', 'export const answer = 42;\n'],
                ['/project/src/ignored.txt', 'should not be copied\n']
            ]);
            const disposable = vscode.workspace.registerFileSystemProvider(
                'copy4ai-test',
                provider,
                { isReadonly: true }
            );

            try {
                const rootUri = vscode.Uri.parse('copy4ai-test:/project');
                const ig = IgnoreUtils.createIgnoreInstance([], true);
                await IgnoreUtils.addGitIgnoreRules(rootUri, ig);

                const tokenSource = new vscode.CancellationTokenSource();
                try {
                    const isExcludedByResourcePath = IgnoreUtils.createResourcePathExclusionFn(rootUri, []);
                    const shouldExcludeContent = IgnoreUtils.createResourceContentExclusionFn(rootUri, []);

                    const projectTree = await ProjectTreeGenerator.generateProjectTree(
                        rootUri,
                        ig,
                        5,
                        0,
                        '',
                        isExcludedByResourcePath,
                        tokenSource.token
                    );
                    assert.ok(projectTree.includes('src'), 'Should include virtual directory in project tree');
                    assert.ok(projectTree.includes('app.ts'), 'Should include virtual file in project tree');
                    assert.ok(!projectTree.includes('ignored.txt'), 'Should respect .gitignore in virtual project tree');

                    const content = await FileProcessor.processDirectory(
                        rootUri,
                        rootUri,
                        ig,
                        {
                            maxFileSize: 1024 * 1024,
                            compressCode: false,
                            removeComments: false,
                            isExcludedByResourcePath,
                            shouldExcludeContent,
                            cancellationToken: tokenSource.token
                        }
                    );

                    assert.deepStrictEqual(
                        content.map(file => file.path).sort(),
                        ['src/app.ts'],
                        'Should only copy non-ignored virtual files'
                    );
                    assert.strictEqual(content[0].content, 'export const answer = 42;\n');
                } finally {
                    tokenSource.dispose();
                }
            } finally {
                disposable.dispose();
            }
        });
    });
});
