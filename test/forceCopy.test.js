const assert = require('assert');
const vscode = require('vscode');
const { Copy4AIService } = require('../out/extension');
const { LastCopyStore } = require('../out/utils/lastCopy');

suite('Force Copy', () => {
    let folder;
    let previousClipboard;
    let previousWarning;
    let clipboard;
    let config;
    let originalSettings;

    setup(async () => {
        folder = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, `force-${Date.now()}`);
        await vscode.workspace.fs.createDirectory(folder);
        previousClipboard = Copy4AIService.clipboard;
        clipboard = { text: 'unchanged', async readText() { return this.text; }, async writeText(text) { this.text = text; } };
        Copy4AIService.clipboard = clipboard;
        previousWarning = vscode.window.showWarningMessage;
        vscode.window.showWarningMessage = async () => 'Force Copy';
        config = vscode.workspace.getConfiguration('copy4ai', folder);
        originalSettings = ['exclude', 'excludeContentPatterns', 'ignoreGitIgnore', 'ignoreDotFiles'].map(key => ({ key, value: config.inspect(key).workspaceValue }));
    });

    teardown(async () => {
        vscode.window.showWarningMessage = previousWarning;
        Copy4AIService.clipboard = previousClipboard;
        for (const { key, value } of originalSettings) {
            await config.update(key, value, vscode.ConfigurationTarget.Workspace);
        }
        await vscode.workspace.fs.delete(folder, { recursive: true });
    });

    test('bypasses all exclusion filters for one copy without changing settings or repeat selection', async () => {
        const regular = vscode.Uri.joinPath(folder, 'normal.txt');
        await vscode.workspace.fs.writeFile(regular, Buffer.from('normal content'));
        await Copy4AIService.copyToClipboard(regular);
        const remembered = LastCopyStore.get().map(uri => uri.toString());
        const relativeFolder = vscode.workspace.asRelativePath(folder);
        await config.update('exclude', { paths: [`${relativeFolder}/private`], patterns: ['*.secret'] }, vscode.ConfigurationTarget.Workspace);
        await config.update('excludeContentPatterns', ['*.svg'], vscode.ConfigurationTarget.Workspace);
        await config.update('ignoreDotFiles', true, vscode.ConfigurationTarget.Workspace);
        await config.update('ignoreGitIgnore', true, vscode.ConfigurationTarget.Workspace);
        // The checked-in workspace .gitignore excludes node_modules.
        const files = new Map([
            ['.hidden', 'hidden content'], ['private/key.txt', 'private content'],
            ['value.secret', 'pattern content'], ['drawing.svg', 'svg content'],
            ['node_modules/module.js', 'gitignored content']
        ]);
        for (const [name, content] of files) {
            const uri = vscode.Uri.joinPath(folder, name);
            await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
            await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
        }
        const settings = config.inspect('exclude').workspaceValue;
        await Copy4AIService.forceCopy(folder);
        for (const [name, content] of files) {
            assert.ok(clipboard.text.includes(name.split('/').pop()), name);
            assert.ok(clipboard.text.includes(content), content);
        }
        assert.deepStrictEqual(config.inspect('exclude').workspaceValue, settings);
        assert.deepStrictEqual(LastCopyStore.get().map(uri => uri.toString()), remembered);
        await Copy4AIService.copyToClipboard(folder);
        for (const content of files.values()) {
            assert.ok(!clipboard.text.includes(content), content);
        }
        assert.ok(clipboard.text.includes('normal content'));
    });

    test('confirmation names the targets and cancelling leaves clipboard and repeat selection unchanged', async () => {
        const file = vscode.Uri.joinPath(folder, '.env');
        await vscode.workspace.fs.writeFile(file, Buffer.from('sensitive content'));
        const remembered = LastCopyStore.get();
        let detail;
        vscode.window.showWarningMessage = async (_message, options) => {
            detail = options.detail;
            return undefined;
        };
        await Copy4AIService.forceCopy(file);
        assert.ok(detail.includes('.env'));
        assert.strictEqual(clipboard.text, 'unchanged');
        assert.deepStrictEqual(LastCopyStore.get(), remembered);
    });

    test('the palette command copies the current selection after confirmation', async () => {
        const file = vscode.Uri.joinPath(folder, '.env');
        await vscode.workspace.fs.writeFile(file, Buffer.from('palette force content'));
        const previousProvider = Copy4AIService.keyboardSelectionProvider;
        let confirmation;
        vscode.window.showWarningMessage = async (_message, options) => {
            confirmation = options.detail;
            return 'Force Copy';
        };
        try {
            Copy4AIService.keyboardSelectionProvider = async () => [file];
            await vscode.commands.executeCommand('snapsource.forceCopy');
            assert.ok(confirmation.includes('.env'));
            assert.ok(clipboard.text.includes('palette force content'));
        } finally {
            Copy4AIService.keyboardSelectionProvider = previousProvider;
        }
    });

    test('Force Copy has no context menu entry or default keyboard shortcut', () => {
        const manifest = require('../package.json');
        const command = manifest.contributes.commands.find(command => command.command === 'snapsource.forceCopy');
        assert.ok(command.title.startsWith('Force'));
        for (const [menu, entries] of Object.entries(manifest.contributes.menus)) {
            if (menu !== 'commandPalette') {
                assert.ok(!entries.some(entry => entry.command === command.command), menu);
            }
        }
        assert.ok(!(manifest.contributes.keybindings ?? []).some(binding => binding.command === command.command));
    });

    test('keeps binary and file size limits when exclusions are bypassed', async () => {
        const binary = vscode.Uri.joinPath(folder, 'image.bin');
        const large = vscode.Uri.joinPath(folder, 'large.txt');
        await vscode.workspace.fs.writeFile(binary, Buffer.from([0, 1, 2, 0, 3]));
        await vscode.workspace.fs.writeFile(large, Buffer.alloc(2 * 1024 * 1024, 'x'));
        await Copy4AIService.forceCopy(folder);
        assert.ok(clipboard.text.includes('[Binary file content not included]'));
        assert.ok(clipboard.text.includes('[File too large:'));
    });

    test('cancellation during a force copy never writes partial output', async () => {
        const file = vscode.Uri.joinPath(folder, '.env');
        await vscode.workspace.fs.writeFile(file, Buffer.from('sensitive content'));
        const originalProgress = vscode.window.withProgress;
        const cancellation = new vscode.CancellationTokenSource();
        const remembered = LastCopyStore.get();
        vscode.window.withProgress = async (options, task) => {
            assert.strictEqual(options.cancellable, true);
            return task({ report(update) {
                if (update.message === 'Copying to clipboard...') {
                    cancellation.cancel();
                }
            } }, cancellation.token);
        };
        try {
            await Copy4AIService.forceCopy(file);
            assert.strictEqual(clipboard.text, 'unchanged');
            assert.deepStrictEqual(LastCopyStore.get(), remembered);
        } finally {
            vscode.window.withProgress = originalProgress;
            cancellation.dispose();
        }
    });
});
