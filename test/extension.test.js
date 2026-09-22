const assert = require('assert');
const vscode = require('vscode');
const {
    OutputFormatter,
    FileProcessor,
    IgnoreUtils,
    ConfigurationService,
    ProjectTreeGenerator,
    TokenCounter,
    SettingsMigration,
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
        // Keyboard Shortcuts lists commands by "category: title". Two commands
        // sharing that label leave the user unable to tell them apart.
        test('Should give every contributed command a distinct Keyboard Shortcuts label', () => {
            const commands = require('../package.json').contributes.commands;
            const labels = commands.map(command => `${command.category}: ${command.title}`);

            assert.deepStrictEqual(
                labels.filter((label, index) => labels.indexOf(label) !== index),
                [],
                `duplicate command labels in the manifest: ${labels.join(', ')}`
            );
        });
    });

    suite('Content Formatting', () => {
        // The one place that pins the formatter's literal output. Everywhere else
        // the expected clipboard content is built with formatOutput itself, so a
        // change to the format would pass unnoticed there.
        const sampleTree = '├── src\n│   └── index.js\n└── package.json\n';
        const sampleFiles = [
            { path: 'src/index.js', content: 'console.log("Hello World")' },
            { path: 'package.json', content: '{"name": "test"}' }
        ];

        test('Should write plaintext as a structure block followed by delimited files', () => {
            assert.strictEqual(
                OutputFormatter.formatOutput('plaintext', sampleTree, sampleFiles),
                'Project Structure:\n' +
                '\n' +
                '├── src\n' +
                '│   └── index.js\n' +
                '└── package.json\n' +
                '\n' +
                '\n' +
                'File Contents:\n' +
                '\n' +
                '--- src/index.js ---\n' +
                'console.log("Hello World")\n' +
                '\n' +
                '--- package.json ---\n' +
                '{"name": "test"}\n' +
                '\n'
            );
        });

        test('Should write markdown with headings and language-tagged code blocks', () => {
            assert.strictEqual(
                OutputFormatter.formatOutput('markdown', sampleTree, sampleFiles),
                '# Project Structure\n' +
                '\n' +
                '```\n' +
                '├── src\n' +
                '│   └── index.js\n' +
                '└── package.json\n' +
                '```\n' +
                '\n' +
                '# File Contents\n' +
                '\n' +
                '## src/index.js\n' +
                '\n' +
                '```javascript\n' +
                'console.log("Hello World")\n' +
                '```\n' +
                '\n' +
                '## package.json\n' +
                '\n' +
                '```json\n' +
                '{"name": "test"}\n' +
                '```\n' +
                '\n'
            );
        });

        test('Should write XML with an indented structure block and CDATA file contents', () => {
            assert.strictEqual(
                OutputFormatter.formatOutput('xml', sampleTree, sampleFiles),
                '<?xml version="1.0" encoding="UTF-8"?>\n' +
                '<copy4ai>\n' +
                '  <project_structure>\n' +
                '    ├── src\n' +
                '    │   └── index.js\n' +
                '    └── package.json\n' +
                '    \n' +
                '  </project_structure>\n' +
                '  <file_contents>\n' +
                '    <file path="src/index.js">\n' +
                '      <![CDATA[console.log("Hello World")]]>\n' +
                '    </file>\n' +
                '    <file path="package.json">\n' +
                '      <![CDATA[{"name": "test"}]]>\n' +
                '    </file>\n' +
                '  </file_contents>\n' +
                '</copy4ai>'
            );
        });

        test('Should omit the structure section when the project tree is empty', async () => {
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

        test('Should escape special characters in the XML path attribute', async () => {
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

        test('Should tag each markdown code block with the language of its file extension', async () => {
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

        test('Should return an empty string when there is no tree and no file content', async () => {
            // Test plaintext and markdown formats (should return empty)
            const emptyFormats = ['plaintext', 'markdown'];
            for (const format of emptyFormats) {
                const result = OutputFormatter.formatOutput(format, '', []);
                assert.strictEqual(result, '', `${format} format should return empty string for empty content and tree`);
            }

            // Test XML format (returns basic XML structure even when empty)
            const xmlResult = OutputFormatter.formatOutput('xml', '', []);
            assert.ok(xmlResult.includes('<?xml version="1.0" encoding="UTF-8"?>'), 'XML should include declaration');
            assert.ok(xmlResult.includes('<copy4ai>'), 'XML should include root element');
            assert.ok(xmlResult.includes('</copy4ai>'), 'XML should close root element');
        });

        test('Should widen the markdown fence when file content contains a code block (#16)', async () => {
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

        test('Should widen the markdown fence past four backticks for nested fences', async () => {
            const deeplyNestedContent = '# Demo\n\n````md\n```js\nconsole.log("hi");\n```\n````';
            const content = [{
                path: 'nested.md',
                content: deeplyNestedContent
            }];

            const result = OutputFormatter.formatOutput('markdown', '', content);
            
            assert.ok(result.includes('`````markdown'), 'Should use 5 backticks when content has 4');
        });

        test('getMarkdownFence should grow the fence past the longest backtick run', () => {
            assert.strictEqual(OutputFormatter.getMarkdownFence('plain text'), '```');
            assert.strictEqual(OutputFormatter.getMarkdownFence('```js\ncode\n```'), '````');
            assert.strictEqual(OutputFormatter.getMarkdownFence('````md\n```\n````'), '`````');
            assert.strictEqual(OutputFormatter.getMarkdownFence('Use `code` or ``double``'), '```');
        });
    });

    suite('Source Preservation', () => {
        test('Should copy links, comments, and whitespace unchanged across file types (#29)', async () => {
            const folderPath = await require('fs/promises').mkdtemp(path.join(__dirname, 'testWorkspace', 'source-preservation-'));
            const folder = vscode.Uri.file(folderPath);
            const config = vscode.workspace.getConfiguration('copy4ai');
            const originalFormat = config.inspect('outputFormat').globalValue;
            const originalTree = config.inspect('includeProjectTree').globalValue;
            const markdown = 'Hello  \n[Test](https://www.example.com)\nWorld!\n\n    indented code\n\n' +
                '`/* literal */`\n```js\n// code example\n```';
            const files = [
                ['README.md', markdown],
                ['links.markdown', markdown],
                ['links.MD', markdown],
                ['script.js', 'const url = "\u{1f600} https://example.com";\nconst pattern = /[/*]/; // comment\n'],
                ['script.ts', 'const url: string = "https://example.com"; /* comment */\n'],
                ['script.py', '#!/usr/bin/env python3\n# -*- coding: utf-8 -*-\nif True:\n    result = 4 // 2 # comment\n'],
                ['main.c', 'const char *url = "https://example.com"; /* comment */\nint/**/main(void) { return 0; }'],
                ['main.cpp', 'auto text = R"tag(first\n\n    /* literal */)tag"; // comment\n'],
                ['config.yaml', 'message: |\n    first\n\n    second\n'],
                ['broken.js', 'const text = "unfinished // retain'],
                ['unknown', 'text /* literal */\r\n\r\n    more text  \r\n']
            ];
            try {
                await config.update('includeProjectTree', false, vscode.ConfigurationTarget.Global);
                for (const [name, content] of files) {
                    const uri = vscode.Uri.joinPath(folder, name);
                    await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
                    for (const format of ['plaintext', 'markdown', 'xml']) {
                        await config.update('outputFormat', format, vscode.ConfigurationTarget.Global);
                        await vscode.commands.executeCommand('snapsource.copyToClipboard', uri);
                        assert.strictEqual(await testClipboard.readText(), OutputFormatter.formatOutput(format, '', [
                            { path: path.basename(folderPath) + '/' + name, content }
                        ]), name + ' in ' + format);
                    }
                }
            } finally {
                await config.update('outputFormat', originalFormat, vscode.ConfigurationTarget.Global);
                await config.update('includeProjectTree', originalTree, vscode.ConfigurationTarget.Global);
                await vscode.workspace.fs.delete(folder, { recursive: true });
            }
        });
    });

    suite('Token Counting', () => {
        test('Should select offline tokenizer by model family', () => {
            const openAiInfo = TokenCounter.countTokens('hello world', 'gpt-5.5');
            assert.strictEqual(openAiInfo.method, 'openai-o200k');
            assert.strictEqual(openAiInfo.approximate, false);
            assert.ok(openAiInfo.inputTokens > 0, 'OpenAI token count should be positive');

            const claudeInfo = TokenCounter.countTokens('hello world', 'claude-sonnet-5');
            assert.strictEqual(claudeInfo.method, 'anthropic-legacy');
            assert.strictEqual(claudeInfo.approximate, true);
            assert.ok(claudeInfo.inputTokens > 0, 'Claude token count should be positive');

            const unknownInfo = TokenCounter.countTokens('hello world', 'new-provider-model');
            assert.strictEqual(unknownInfo.method, 'chars-heuristic');
            assert.strictEqual(unknownInfo.approximate, true);
        });

        test('Should select the tokenizer for dated and suffixed model names', () => {
            assert.strictEqual(TokenCounter.countTokens('hi', 'claude-opus-5-20260416').method, 'anthropic-legacy');
            assert.strictEqual(TokenCounter.countTokens('hi', 'gpt-5-codex-2026-01-01').method, 'openai-o200k');
            assert.strictEqual(TokenCounter.countTokens('hi', 'o3-mini').method, 'openai-o200k');
        });

        test('Should warn above copy4ai.maxTokens and stay quiet when it is off', async () => {
            const originalWarning = vscode.window.showWarningMessage;
            const originalStatusBar = vscode.window.setStatusBarMessage;
            const warnings = [];
            const statusBar = [];
            vscode.window.showWarningMessage = (text) => {
                warnings.push(text);
                return Promise.resolve(undefined);
            };
            vscode.window.setStatusBarMessage = (text) => {
                statusBar.push(text);
                return { dispose() {} };
            };

            try {
                const content = 'word '.repeat(200);
                for (const [maxTokens, expectWarning] of [[50, true], [null, false], [0, false]]) {
                    warnings.length = 0;
                    statusBar.length = 0;
                    await TokenCounter.showTokenInfo(content, 'claude-sonnet-5', 'markdown', true, maxTokens);
                    assert.strictEqual(warnings.length, expectWarning ? 1 : 0, `maxTokens ${maxTokens}: warnings ${JSON.stringify(warnings)}`);
                    assert.strictEqual(statusBar.length, expectWarning ? 0 : 1, `maxTokens ${maxTokens}: status bar ${JSON.stringify(statusBar)}`);
                }
            } finally {
                vscode.window.showWarningMessage = originalWarning;
                vscode.window.setStatusBarMessage = originalStatusBar;
            }
        });
    });

    suite('Command Functionality', () => {
        test('Should replace binary file content with a placeholder', async () => {
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

        test('Should replace content above maxFileSize with the measured size', async () => {
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

        test('Should copy the content of every file in a multi-file selection', async function() {
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

        test('Should limit the copied tree to the selected files (#26, #28)', async () => {
            const folderPath = await require('fs/promises').mkdtemp(path.join(__dirname, 'testWorkspace', 'selection-tree-'));
            const folder = vscode.Uri.file(folderPath);
            const folderName = path.basename(folderPath);
            const files = [
                ['src/selected.ts', 'export const selected = true;'],
                ['lib/second.ts', 'export const second = true;'],
                ['src/selected.ts.bak', 'unselected sibling'],
                ['lib/unselected.ts', 'unselected file']
            ];

            try {
                for (const [name, content] of files) {
                    const uri = vscode.Uri.joinPath(folder, name);
                    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(uri.fsPath)));
                    await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
                }
                const selected = files.slice(0, 2).map(([name]) => vscode.Uri.joinPath(folder, name));

                await vscode.commands.executeCommand('snapsource.copyToClipboard', selected[0], selected);

                assert.strictEqual(
                    await testClipboard.readText(),
                    OutputFormatter.formatOutput(
                        'markdown',
                        `└── ${folderName}\n    ├── lib\n    │   └── second.ts\n    └── src\n        └── selected.ts\n`,
                        files.slice(0, 2).map(([name, content]) => ({ path: `${folderName}/${name}`, content }))
                    )
                );
            } finally {
                await vscode.workspace.fs.delete(folder, { recursive: true });
            }
        });

        test('Should omit ancestors of missing and ignored selected files from the copied tree', async () => {
            const folderPath = await require('fs/promises').mkdtemp(path.join(__dirname, 'testWorkspace', 'selection-skipped-'));
            const folder = vscode.Uri.file(folderPath);
            const keep = vscode.Uri.joinPath(folder, 'keep.txt');
            try {
                await vscode.workspace.fs.writeFile(keep, Buffer.from('keep this'));
                for (const name of ['missing/other.txt', 'ignored/skip.log', 'hidden/.skip']) {
                    const uri = vscode.Uri.joinPath(folder, name);
                    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(uri.fsPath)));
                    await vscode.workspace.fs.writeFile(uri, Buffer.from('not copied'));
                }
                for (const name of ['missing/deleted.txt', 'ignored/skip.log', 'hidden/.skip']) {
                    await vscode.commands.executeCommand('snapsource.copyToClipboard', keep, [keep, vscode.Uri.joinPath(folder, name)]);
                    const output = await testClipboard.readText();
                    const expectedTree = `└── ${path.basename(folderPath)}\n    └── keep.txt\n`;
                    assert.strictEqual(output, OutputFormatter.formatOutput('markdown', expectedTree, [
                        { path: `${path.basename(folderPath)}/keep.txt`, content: 'keep this' }
                    ]), name);
                }
            } finally {
                await vscode.workspace.fs.delete(folder, { recursive: true });
            }
        });

        test('Should include selected folder descendants and keep exclusion rules (#26, #28)', async () => {
            const folderPath = await require('fs/promises').mkdtemp(path.join(__dirname, 'testWorkspace', 'selection-folder-'));
            const folder = vscode.Uri.file(folderPath);
            const folderName = path.basename(folderPath);
            const selectedFolder = vscode.Uri.joinPath(folder, 'src');
            const selectedFile = vscode.Uri.joinPath(folder, 'other', 'selected.txt');

            try {
                for (const name of ['src/nested/child.txt', 'src/top.txt', 'src/ignored.log', 'src/.hidden', 'src-other/unselected.txt', 'other/selected.txt', 'other/unselected.txt']) {
                    const uri = vscode.Uri.joinPath(folder, name);
                    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(uri.fsPath)));
                    await vscode.workspace.fs.writeFile(uri, Buffer.from(name));
                }
                await vscode.commands.executeCommand('snapsource.copyToClipboard', selectedFolder, [
                    selectedFolder, selectedFile, vscode.Uri.joinPath(selectedFolder, 'top.txt')
                ]);
                const output = await testClipboard.readText();
                const expectedTree = `└── ${folderName}\n    ├── other\n    │   └── selected.txt\n    └── src\n        ├── nested\n        │   └── child.txt\n        └── top.txt\n`;
                assert.ok(output.startsWith(`# Project Structure\n\n\`\`\`\n${expectedTree}\`\`\`\n`), output);
                assert.ok(!output.includes('unselected.txt'));
                assert.ok(!output.includes('ignored.log'));
                assert.ok(!output.includes('.hidden'));
                assert.strictEqual((output.match(/## .*\/src\/top.txt/g) ?? []).length, 1);
            } finally {
                await vscode.workspace.fs.delete(folder, { recursive: true });
            }
        });

        // Both tests below build the same fixture; the expected tree is the
        // point of comparison between the two commands.
        const singleFolderTree = 'src/\n├── nested\n│   └── child.txt\n└── top.txt\n';

        async function makeSingleFolderFixture() {
            const folderPath = await require('fs/promises').mkdtemp(path.join(__dirname, 'testWorkspace', 'selection-root-'));
            for (const name of ['src/nested/child.txt', 'src/top.txt']) {
                const uri = vscode.Uri.joinPath(vscode.Uri.file(folderPath), name);
                await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(uri.fsPath)));
                await vscode.workspace.fs.writeFile(uri, Buffer.from(name));
            }
            return folderPath;
        }

        test('Should root the tree at the selected folder when copying its contents', async () => {
            const folderPath = await makeSingleFolderFixture();
            const selectedFolder = vscode.Uri.joinPath(vscode.Uri.file(folderPath), 'src');

            try {
                await vscode.commands.executeCommand('snapsource.copyToClipboard', selectedFolder);

                const output = await testClipboard.readText();
                assert.ok(output.startsWith(`# Project Structure\n\n\`\`\`\n${singleFolderTree}\`\`\`\n`), output);
                assert.ok(output.includes(`## ${path.basename(folderPath)}/src/top.txt`), output);
            } finally {
                await vscode.workspace.fs.delete(vscode.Uri.file(folderPath), { recursive: true });
            }
        });

        test('Should root the tree at the selected folder when copying the structure only', async () => {
            const folderPath = await makeSingleFolderFixture();
            const selectedFolder = vscode.Uri.joinPath(vscode.Uri.file(folderPath), 'src');

            try {
                await vscode.commands.executeCommand('snapsource.copyProjectStructure', selectedFolder);

                assert.strictEqual(
                    await testClipboard.readText(),
                    OutputFormatter.formatProjectStructureOnly('markdown', singleFolderTree)
                );
            } finally {
                await vscode.workspace.fs.delete(vscode.Uri.file(folderPath), { recursive: true });
            }
        });

        test('Should copy keyboard-selected files when invoked without URI arguments', async function() {
            this.timeout(10000);

            const testWorkspacePath = path.join(__dirname, 'testWorkspace');
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(testWorkspacePath));

            const testFiles = [
                { name: 'hotkey-test1.txt', content: 'Hotkey content one' },
                { name: 'hotkey-test2.txt', content: 'Hotkey content two' }
            ];
            const uris = [];
            const previousProvider = Copy4AIService.keyboardSelectionProvider;

            try {
                for (const file of testFiles) {
                    const uri = vscode.Uri.file(path.join(testWorkspacePath, file.name));
                    await vscode.workspace.fs.writeFile(uri, Buffer.from(file.content));
                    uris.push(uri);
                }

                if (!vscode.workspace.workspaceFolders ||
                    !vscode.workspace.workspaceFolders[0].uri.fsPath.includes('testWorkspace')) {
                    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(testWorkspacePath));
                }

                Copy4AIService.keyboardSelectionProvider = async () => uris;

                await vscode.commands.executeCommand('snapsource.copyToClipboard');

                const clipboardContent = await testClipboard.readText();
                assert.ok(clipboardContent.includes('Hotkey content one'), 'Should include first keyboard-selected file');
                assert.ok(clipboardContent.includes('Hotkey content two'), 'Should include second keyboard-selected file');
            } finally {
                Copy4AIService.keyboardSelectionProvider = previousProvider;

                for (const uri of uris) {
                    try {
                        await vscode.workspace.fs.delete(uri);
                    } catch (err) {
                        console.error(`Error cleaning up hotkey test file: ${err.message}`);
                    }
                }
            }
        });

        test('Should copy duplicate selected files only once', async function() {
            this.timeout(10000);

            const testWorkspacePath = path.join(__dirname, 'testWorkspace');
            const uri = vscode.Uri.file(path.join(testWorkspacePath, 'duplicate-selection.txt'));

            try {
                await vscode.workspace.fs.writeFile(uri, Buffer.from('Duplicate selection content'));

                if (!vscode.workspace.workspaceFolders ||
                    !vscode.workspace.workspaceFolders[0].uri.fsPath.includes('testWorkspace')) {
                    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(testWorkspacePath));
                }

                await vscode.commands.executeCommand('snapsource.copyToClipboard', uri, [uri, uri]);

                const clipboardContent = await testClipboard.readText();
                const contentOccurrences = clipboardContent.match(/Duplicate selection content/g) ?? [];
                assert.strictEqual(contentOccurrences.length, 1, 'Duplicate file selections should be copied once');
            } finally {
                try {
                    await vscode.workspace.fs.delete(uri);
                } catch (err) {
                    console.error(`Error cleaning up duplicate selection test file: ${err.message}`);
                }
            }
        });

        test('Should copy nested explorer selections only once when folder and child are both selected', async function() {
            this.timeout(10000);

            const testWorkspacePath = path.join(__dirname, 'testWorkspace');
            const folderUri = vscode.Uri.file(path.join(testWorkspacePath, 'nested-copy'));
            const childUri = vscode.Uri.file(path.join(testWorkspacePath, 'nested-copy', 'child.txt'));

            try {
                await vscode.workspace.fs.createDirectory(folderUri);
                await vscode.workspace.fs.writeFile(childUri, Buffer.from('Nested explorer child content'));

                if (!vscode.workspace.workspaceFolders ||
                    !vscode.workspace.workspaceFolders[0].uri.fsPath.includes('testWorkspace')) {
                    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(testWorkspacePath));
                }

                await vscode.commands.executeCommand('snapsource.copyToClipboard', folderUri, [folderUri, childUri]);

                const clipboardContent = await testClipboard.readText();
                const childContentOccurrences = clipboardContent.match(/Nested explorer child content/g) ?? [];
                assert.strictEqual(
                    childContentOccurrences.length,
                    1,
                    'Child file content should appear only once when both its folder and file are selected'
                );
            } finally {
                try {
                    await vscode.workspace.fs.delete(folderUri, { recursive: true });
                } catch (err) {
                    console.error(`Error cleaning up nested explorer selection test folder: ${err.message}`);
                }
            }
        });

        test('Should copy nested keyboard selections only once when folder and child are both selected', async function() {
            this.timeout(10000);

            const testWorkspacePath = path.join(__dirname, 'testWorkspace');
            const folderUri = vscode.Uri.file(path.join(testWorkspacePath, 'nested-hotkey-copy'));
            const childUri = vscode.Uri.file(path.join(testWorkspacePath, 'nested-hotkey-copy', 'child.txt'));
            const previousProvider = Copy4AIService.keyboardSelectionProvider;

            try {
                await vscode.workspace.fs.createDirectory(folderUri);
                await vscode.workspace.fs.writeFile(childUri, Buffer.from('Nested keyboard child content'));

                if (!vscode.workspace.workspaceFolders ||
                    !vscode.workspace.workspaceFolders[0].uri.fsPath.includes('testWorkspace')) {
                    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(testWorkspacePath));
                }

                Copy4AIService.keyboardSelectionProvider = async () => [folderUri, childUri, childUri];

                await vscode.commands.executeCommand('snapsource.copyToClipboard');

                const clipboardContent = await testClipboard.readText();
                const childContentOccurrences = clipboardContent.match(/Nested keyboard child content/g) ?? [];
                assert.strictEqual(
                    childContentOccurrences.length,
                    1,
                    'Child file content should appear only once for nested keyboard selections'
                );
            } finally {
                Copy4AIService.keyboardSelectionProvider = previousProvider;

                try {
                    await vscode.workspace.fs.delete(folderUri, { recursive: true });
                } catch (err) {
                    console.error(`Error cleaning up nested keyboard selection test folder: ${err.message}`);
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
            const previousProvider = Copy4AIService.keyboardSelectionProvider;

            try {
                Copy4AIService.keyboardSelectionProvider = async () => [];
                await vscode.commands.executeCommand('snapsource.copyToClipboard');
            } finally {
                Copy4AIService.keyboardSelectionProvider = previousProvider;
            }

            const clipboardContent = await testClipboard.readText();
            assert.ok(clipboardContent.includes('app.js'), 'Should include active editor file path');
            assert.ok(
                clipboardContent.includes("console.log('Hello from the test workspace!');"),
                'Should include active editor file content'
            );
        });

        test('Should repeat the last copy without a selection (#31)', async function() {
            this.timeout(10000);

            const testWorkspacePath = path.join(__dirname, 'testWorkspace');
            const uris = [
                vscode.Uri.file(path.join(testWorkspacePath, 'repeat-one.txt')),
                vscode.Uri.file(path.join(testWorkspacePath, 'repeat-two.txt'))
            ];

            try {
                await vscode.workspace.fs.writeFile(uris[0], Buffer.from('Repeat content one'));
                await vscode.workspace.fs.writeFile(uris[1], Buffer.from('Repeat content two'));

                await vscode.commands.executeCommand('snapsource.copyToClipboard', uris[0], uris);
                const firstCopy = await testClipboard.readText();
                testClipboard.text = '';

                await vscode.commands.executeCommand('snapsource.repeatLastCopy');

                assert.strictEqual(await testClipboard.readText(), firstCopy);
            } finally {
                for (const uri of uris) {
                    await vscode.workspace.fs.delete(uri);
                }
            }
        });

        test('Should repeat the last file copy, not a project structure copy in between (#31)', async function() {
            this.timeout(10000);

            const testWorkspacePath = path.join(__dirname, 'testWorkspace');
            const uri = vscode.Uri.file(path.join(testWorkspacePath, 'repeat-guard.txt'));

            try {
                await vscode.workspace.fs.writeFile(uri, Buffer.from('Repeat guard content'));

                await vscode.commands.executeCommand('snapsource.copyToClipboard', uri, [uri]);
                await vscode.commands.executeCommand('snapsource.copyProjectStructure', vscode.Uri.file(testWorkspacePath));
                testClipboard.text = '';

                await vscode.commands.executeCommand('snapsource.repeatLastCopy');

                assert.ok(
                    (await testClipboard.readText()).includes('Repeat guard content'),
                    'Should repeat the file copy, not the tree-only copy'
                );
            } finally {
                await vscode.workspace.fs.delete(uri);
            }
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

        test('Should copy keyboard-selected files when SCM copy command is invoked without resource states', async function() {
            this.timeout(10000);
            await ensureTestWorkspace();

            const testFiles = [
                { name: 'scm-hotkey-test1.txt', content: 'SCM hotkey content one' },
                { name: 'scm-hotkey-test2.txt', content: 'SCM hotkey content two' }
            ];
            const uris = [];
            const previousProvider = Copy4AIService.keyboardSelectionProvider;

            try {
                for (const file of testFiles) {
                    const uri = vscode.Uri.file(path.join(testWorkspacePath, file.name));
                    await vscode.workspace.fs.writeFile(uri, Buffer.from(file.content));
                    uris.push(uri);
                }

                Copy4AIService.keyboardSelectionProvider = async () => uris;

                await vscode.commands.executeCommand('snapsource.copyScmResources');

                const clipboardContent = await testClipboard.readText();
                assert.ok(clipboardContent.includes('SCM hotkey content one'), 'Should include first keyboard-selected file');
                assert.ok(clipboardContent.includes('SCM hotkey content two'), 'Should include second keyboard-selected file');
            } finally {
                Copy4AIService.keyboardSelectionProvider = previousProvider;

                for (const uri of uris) {
                    try {
                        await vscode.workspace.fs.delete(uri);
                    } catch (error) {
                        console.error(`Error cleaning up SCM hotkey test file: ${error.message}`);
                    }
                }
            }
        });

        test('Should copy nested SCM selections only once when folder and child are both selected', async function() {
            this.timeout(10000);
            await ensureTestWorkspace();

            const folderUri = vscode.Uri.file(path.join(testWorkspacePath, 'scm-nested'));
            const childUri = vscode.Uri.file(path.join(testWorkspacePath, 'scm-nested', 'child.txt'));

            try {
                await vscode.workspace.fs.createDirectory(folderUri);
                await vscode.workspace.fs.writeFile(childUri, Buffer.from('Nested SCM child content'));

                await vscode.commands.executeCommand(
                    'snapsource.copyScmResources',
                    { resourceUri: folderUri },
                    { resourceUri: childUri }
                );

                const clipboardContent = await testClipboard.readText();
                const childContentOccurrences = clipboardContent.match(/Nested SCM child content/g) ?? [];
                assert.strictEqual(
                    childContentOccurrences.length,
                    1,
                    'Child file content should appear only once when both its folder and file are selected'
                );
            } finally {
                try {
                    await vscode.workspace.fs.delete(folderUri, { recursive: true });
                } catch (error) {
                    console.error(`Error cleaning up nested SCM test folder: ${error.message}`);
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

    suite('Copy Feedback', () => {
        test('Should confirm a finished copy in the status bar, not as a notification', async () => {
            const folderPath = await require('fs/promises').mkdtemp(path.join(__dirname, 'testWorkspace', 'feedback-'));
            const folder = vscode.Uri.file(folderPath);
            const file = vscode.Uri.joinPath(folder, 'note.txt');
            const originalStatusBar = vscode.window.setStatusBarMessage;
            const originalNotification = vscode.window.showInformationMessage;
            const originalProgress = vscode.window.withProgress;
            const statusBar = [];
            const notifications = [];
            const progressLocations = [];
            vscode.window.withProgress = (options, task) => {
                progressLocations.push(options.location);
                return originalProgress.call(vscode.window, options, task);
            };
            vscode.window.setStatusBarMessage = (text) => {
                statusBar.push(text);
                return { dispose() {} };
            };
            vscode.window.showInformationMessage = (text) => {
                notifications.push(text);
                return Promise.resolve(undefined);
            };

            try {
                await vscode.workspace.fs.writeFile(file, Buffer.from('note'));
                await vscode.commands.executeCommand('snapsource.copyToClipboard', file);

                assert.ok((await testClipboard.readText()).includes('note'), 'file is copied');
                assert.deepStrictEqual(notifications, [], 'copying posts no notification');
                assert.strictEqual(statusBar.length, 1, `status bar got ${JSON.stringify(statusBar)}`);
                assert.match(statusBar[0], /Copied to clipboard \(markdown\)/);
                assert.deepStrictEqual(progressLocations, [vscode.ProgressLocation.Window], 'progress belongs in the status bar');
            } finally {
                vscode.window.setStatusBarMessage = originalStatusBar;
                vscode.window.showInformationMessage = originalNotification;
                vscode.window.withProgress = originalProgress;
                await vscode.workspace.fs.delete(folder, { recursive: true });
            }
        });
    });

    suite('SCM Diff Copy', () => {
        const cp = require('child_process');
        const testWorkspacePath = path.join(__dirname, 'testWorkspace');
        const repoDir = path.join(testWorkspacePath, 'diffrepo');
        const trackedUri = vscode.Uri.file(path.join(repoDir, 'tracked.txt'));
        const pristineUri = vscode.Uri.file(path.join(repoDir, 'pristine.txt'));
        const brandnewUri = vscode.Uri.file(path.join(repoDir, 'brandnew.txt'));
        const nestedDiffFolderUri = vscode.Uri.file(path.join(repoDir, 'nested-diff'));
        const nestedDiffChildUri = vscode.Uri.file(path.join(repoDir, 'nested-diff', 'child.txt'));
        let gitRepo;

        function git(args) {
            cp.execSync(`git -c user.name=Test -c user.email=test@example.com ${args}`, {
                cwd: repoDir,
                env: {
                    ...process.env,
                    GIT_CONFIG_GLOBAL: require('os').devNull,
                    GIT_CONFIG_NOSYSTEM: '1'
                }
            });
        }

        suiteSetup(async function() {
            this.timeout(30000);

            await vscode.workspace.fs.createDirectory(vscode.Uri.file(repoDir));
            git('init -b main');
            // Pin diff output format so assertions don't depend on the
            // developer's global git config (e.g. diff.mnemonicprefix)
            git('config diff.mnemonicprefix false');
            git('config diff.noprefix false');
            await vscode.workspace.fs.createDirectory(nestedDiffFolderUri);
            await vscode.workspace.fs.writeFile(trackedUri, Buffer.from('original line\n'));
            await vscode.workspace.fs.writeFile(pristineUri, Buffer.from('unchanged content\n'));
            await vscode.workspace.fs.writeFile(nestedDiffChildUri, Buffer.from('nested original\n'));
            git('add .');
            git('commit -m initial');
            await vscode.workspace.fs.writeFile(trackedUri, Buffer.from('changed line\n'));
            await vscode.workspace.fs.writeFile(nestedDiffChildUri, Buffer.from('nested changed\n'));
            await vscode.workspace.fs.writeFile(brandnewUri, Buffer.from('fresh content\n'));

            const gitExtension = vscode.extensions.getExtension('vscode.git');
            const exports = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
            const api = exports.getAPI(1);
            gitRepo = await api.openRepository(vscode.Uri.file(repoDir));
            await gitRepo.status();
        });

        suiteTeardown(async function() {
            this.timeout(10000);
            try {
                await vscode.workspace.fs.delete(vscode.Uri.file(repoDir), { recursive: true });
            } catch (error) {
                console.error(`Error cleaning up diff test repo: ${error.message}`);
            }
        });

        test('Should copy a unified diff for a modified file', async function() {
            this.timeout(10000);

            await vscode.commands.executeCommand('snapsource.copyScmChanges', { resourceUri: trackedUri });

            const clipboardContent = await testClipboard.readText();
            assert.ok(clipboardContent.includes('```diff'), 'Should wrap the diff in a fenced diff block (markdown default)');
            assert.ok(clipboardContent.includes('diff --git a/tracked.txt b/tracked.txt'), 'Should include the git diff header');
            assert.ok(clipboardContent.includes('-original line'), 'Should include the removed line');
            assert.ok(clipboardContent.includes('+changed line'), 'Should include the added line');
        });

        test('Should include untracked files as new-file diffs', async function() {
            this.timeout(10000);

            await vscode.commands.executeCommand('snapsource.copyScmChanges', { resourceUri: brandnewUri });

            const clipboardContent = await testClipboard.readText();
            assert.ok(clipboardContent.includes('diff --git a/brandnew.txt b/brandnew.txt'), 'Should include a diff header for the untracked file');
            assert.ok(clipboardContent.includes('new file mode'), 'Should mark the file as new');
            assert.ok(clipboardContent.includes('+fresh content'), 'Should include the file content as additions');
        });

        test('Should combine multiple selections and dedupe repeats', async function() {
            this.timeout(10000);

            await vscode.commands.executeCommand(
                'snapsource.copyScmChanges',
                { resourceUri: trackedUri },
                { resourceUri: trackedUri },
                { resourceUri: brandnewUri }
            );

            const clipboardContent = await testClipboard.readText();
            const trackedHeaders = clipboardContent.split('diff --git a/tracked.txt').length - 1;
            assert.strictEqual(trackedHeaders, 1, 'Should include the duplicated selection only once');
            assert.ok(clipboardContent.includes('+changed line'), 'Should include the modified file diff');
            assert.ok(clipboardContent.includes('+fresh content'), 'Should include the untracked file diff');
        });

        test('Should copy nested diff selections only once when folder and child are both selected', async function() {
            this.timeout(10000);

            await vscode.commands.executeCommand(
                'snapsource.copyScmChanges',
                { resourceUri: nestedDiffFolderUri },
                { resourceUri: nestedDiffChildUri }
            );

            const clipboardContent = await testClipboard.readText();
            const nestedHeaders = clipboardContent.split('diff --git a/nested-diff/child.txt').length - 1;
            assert.strictEqual(nestedHeaders, 1, 'Should include the nested child diff only once');
            assert.ok(clipboardContent.includes('+nested changed'), 'Should include the nested child change');
        });

        test('Should fail without touching the clipboard when selection has no changes', async function() {
            this.timeout(10000);

            const sentinel = 'diff-clipboard-sentinel-' + Math.random();
            await testClipboard.writeText(sentinel);

            await assert.rejects(
                Promise.resolve(vscode.commands.executeCommand(
                    'snapsource.copyScmChanges',
                    { resourceUri: pristineUri }
                )),
                /[Nn]o changes/,
                'Should reject because the file has no changes'
            );

            const clipboardContent = await testClipboard.readText();
            assert.strictEqual(clipboardContent, sentinel, 'Clipboard should be unchanged');
        });
    });

    suite('Exclusion Patterns', () => {
        test('Should resolve copy4ai.exclude across scopes before copying', async () => {
            const folderPath = await require('fs/promises').mkdtemp(path.join(__dirname, 'testWorkspace', 'exclusions-'));
            const folder = vscode.Uri.file(folderPath);
            const config = vscode.workspace.getConfiguration('copy4ai', folder);
            const original = ['exclude', 'ignoreGitIgnore'].map(key => ({ ...config.inspect(key), key }));
            const settingsUri = vscode.Uri.joinPath(vscode.workspace.getWorkspaceFolder(folder).uri, '.vscode', 'settings.json');
            const settingsBytes = await vscode.workspace.fs.readFile(settingsUri);

            try {
                for (const { key } of original) {
                    await config.update(key, undefined, vscode.ConfigurationTarget.Global);
                    await config.update(key, undefined, vscode.ConfigurationTarget.Workspace);
                }
                await config.update('ignoreGitIgnore', false, vscode.ConfigurationTarget.Workspace);
                const privatePath = `${path.basename(folderPath)}/private`;
                const files = ['keep.txt', 'skip.tmp', 'private/key.txt', 'debug.log', 'node_modules/dependency.js'];
                for (const name of files) {
                    const uri = vscode.Uri.joinPath(folder, name);
                    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(uri.fsPath)));
                    await vscode.workspace.fs.writeFile(uri, Buffer.from(`contents of ${name}`));
                }

                const scenarios = [
                    { name: 'unset keeps the defaults', excluded: ['debug.log', 'node_modules/dependency.js'] },
                    { name: 'empty object keeps the defaults', global: {}, excluded: ['debug.log', 'node_modules/dependency.js'] },
                    { name: 'empty arrays disable exclusions', workspace: { paths: [], patterns: [] }, excluded: [] },
                    {
                        name: 'partial object retains the default patterns',
                        workspace: { paths: [privatePath] },
                        excluded: ['private/key.txt', 'debug.log', 'node_modules/dependency.js']
                    },
                    {
                        name: 'paths and patterns merge across scopes',
                        global: { paths: [privatePath] }, workspace: { patterns: ['*.tmp'] },
                        excluded: ['skip.tmp', 'private/key.txt']
                    }
                ];

                for (const scenario of scenarios) {
                    await config.update('exclude', scenario.global, vscode.ConfigurationTarget.Global);
                    await config.update('exclude', scenario.workspace, vscode.ConfigurationTarget.Workspace);
                    await vscode.commands.executeCommand('snapsource.copyToClipboard', folder);
                    const output = await testClipboard.readText();
                    for (const name of files) {
                        const included = !scenario.excluded.includes(name);
                        assert.strictEqual(output.includes(path.basename(name)), included, `${scenario.name}: tree entry ${name}`);
                        assert.strictEqual(output.includes(`contents of ${name}`), included, `${scenario.name}: contents of ${name}`);
                    }
                }
            } finally {
                for (const { key, globalValue, workspaceValue } of original) {
                    await config.update(key, globalValue, vscode.ConfigurationTarget.Global);
                    await config.update(key, workspaceValue, vscode.ConfigurationTarget.Workspace);
                }
                await vscode.workspace.fs.writeFile(settingsUri, settingsBytes);
                await vscode.workspace.fs.delete(folder, { recursive: true });
            }
        });

        test('Should move the deprecated exclusion settings into copy4ai.exclude and delete them', async () => {
            const config = vscode.workspace.getConfiguration('copy4ai');
            const original = ['exclude', 'excludePaths', 'excludePatterns']
                .map(key => ({ key, globalValue: config.inspect(key).globalValue }));

            try {
                await config.update('exclude', undefined, vscode.ConfigurationTarget.Global);
                await config.update('excludePaths', ['src/secrets'], vscode.ConfigurationTarget.Global);
                await config.update('excludePatterns', ['*.pem'], vscode.ConfigurationTarget.Global);

                await SettingsMigration.migrateLegacyExclusions();

                const migrated = vscode.workspace.getConfiguration('copy4ai');
                assert.deepStrictEqual(
                    migrated.inspect('exclude').globalValue,
                    { paths: ['src/secrets'], patterns: ['*.pem'] }
                );
                assert.strictEqual(migrated.inspect('excludePaths').globalValue, undefined, 'excludePaths should be gone');
                assert.strictEqual(migrated.inspect('excludePatterns').globalValue, undefined, 'excludePatterns should be gone');
            } finally {
                for (const { key, globalValue } of original) {
                    await config.update(key, globalValue, vscode.ConfigurationTarget.Global);
                }
            }
        });

        test('Should keep an existing copy4ai.exclude when deleting the deprecated settings', async () => {
            const config = vscode.workspace.getConfiguration('copy4ai');
            const original = ['exclude', 'excludePaths', 'excludePatterns']
                .map(key => ({ key, globalValue: config.inspect(key).globalValue }));

            try {
                await config.update('exclude', { paths: ['keep/me'], patterns: [] }, vscode.ConfigurationTarget.Global);
                await config.update('excludePaths', ['src/secrets'], vscode.ConfigurationTarget.Global);

                await SettingsMigration.migrateLegacyExclusions();

                const migrated = vscode.workspace.getConfiguration('copy4ai');
                assert.deepStrictEqual(
                    migrated.inspect('exclude').globalValue,
                    { paths: ['keep/me'], patterns: [] },
                    'a value the user already set wins over the deprecated one'
                );
                assert.strictEqual(migrated.inspect('excludePaths').globalValue, undefined, 'excludePaths should be gone');
            } finally {
                for (const { key, globalValue } of original) {
                    await config.update(key, globalValue, vscode.ConfigurationTarget.Global);
                }
            }
        });

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

        test('Should exclude the configured path only, not same-named folders elsewhere (#5)', async function() {
            this.timeout(10000);

            // The test workspace ships copy4ai.exclude.paths: ["src/config"] in
            // .vscode/settings.json, and holds a second config.js under
            // vendor/package/config that must survive.
            const testWorkspacePath = path.join(__dirname, 'testWorkspace');
            await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(testWorkspacePath));

            await vscode.commands.executeCommand('snapsource.copyProjectStructure');

            const tree = await testClipboard.readText();
            assert.strictEqual(
                (tree.match(/config\.js/g) ?? []).length,
                1,
                `tree should list vendor's config.js and not src/config's:\n${tree}`
            );
            assert.ok(tree.includes('vendor'), `vendor folder missing from tree:\n${tree}`);
        });

        test('Should replace an unreadable file with a placeholder and keep copying the rest', async () => {
            const folderPath = await require('fs/promises').mkdtemp(path.join(__dirname, 'testWorkspace', 'unreadable-'));
            const folder = vscode.Uri.file(folderPath);
            const folderName = path.basename(folderPath);
            const code = vscode.Uri.joinPath(folder, 'app.ts');
            const legacy = vscode.Uri.joinPath(folder, 'legacy.txt');

            try {
                await vscode.workspace.fs.writeFile(code, Buffer.from('export const answer = 42;'));
                // UTF-16 LE without a BOM: isBinaryFile claims it on the null
                // bytes before the encoding branches in FileProcessor run.
                await vscode.workspace.fs.writeFile(legacy, Buffer.from('legacy text', 'utf16le'));

                await vscode.commands.executeCommand('snapsource.copyToClipboard', code, [legacy, code]);

                assert.strictEqual(
                    await testClipboard.readText(),
                    OutputFormatter.formatOutput('markdown', `└── ${folderName}\n    ├── app.ts\n    └── legacy.txt\n`, [
                        { path: `${folderName}/legacy.txt`, content: '[Binary file content not included]' },
                        { path: `${folderName}/app.ts`, content: 'export const answer = 42;' }
                    ])
                );
            } finally {
                await vscode.workspace.fs.delete(folder, { recursive: true });
            }
        });

        test('Should list a file matched by excludeContentPatterns in the tree but drop its content', async () => {
            const folderPath = await require('fs/promises').mkdtemp(path.join(__dirname, 'testWorkspace', 'content-exclusion-'));
            const folder = vscode.Uri.file(folderPath);
            const folderName = path.basename(folderPath);
            const config = vscode.workspace.getConfiguration('copy4ai');
            const originalPatterns = config.inspect('excludeContentPatterns').globalValue;
            const code = vscode.Uri.joinPath(folder, 'app.ts');
            const icon = vscode.Uri.joinPath(folder, 'icon.svg');

            try {
                await config.update('excludeContentPatterns', ['**/*.svg'], vscode.ConfigurationTarget.Global);
                await vscode.workspace.fs.writeFile(code, Buffer.from('export const answer = 42;'));
                await vscode.workspace.fs.writeFile(icon, Buffer.from('<svg></svg>'));

                await vscode.commands.executeCommand('snapsource.copyToClipboard', code, [code, icon]);

                assert.strictEqual(
                    await testClipboard.readText(),
                    OutputFormatter.formatOutput('markdown', `└── ${folderName}\n    ├── app.ts\n    └── icon.svg\n`, [
                        { path: `${folderName}/app.ts`, content: 'export const answer = 42;' },
                        { path: `${folderName}/icon.svg`, content: '[File content not included]' }
                    ])
                );
            } finally {
                await config.update('excludeContentPatterns', originalPatterns, vscode.ConfigurationTarget.Global);
                await vscode.workspace.fs.delete(folder, { recursive: true });
            }
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
