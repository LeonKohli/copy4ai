const assert = require('assert');
const vscode = require('vscode');
const path = require('path');
const { TabSelection } = require('../out/utils/tabSelection');

function selectionBoundary(uris, copiedText, copyPaths) {
    const clipboard = {
        text: 'previous clipboard',
        async readText() { return this.text; },
        async writeText(text) { this.text = text; }
    };
    return {
        clipboard,
        tabs: uris.map(uri => ({ input: new vscode.TabInputText(uri) })),
        copyPaths: copyPaths ?? (async () => { clipboard.text = copiedText; })
    };
}

suite('Selected editor tabs', () => {
    test('Copies the native selection using the clicked URI and restores the clipboard', async () => {
        const first = vscode.Uri.file('/project/first.ts');
        const second = vscode.Uri.file('/project/second.ts');
        const boundary = selectionBoundary([first, second]);
        boundary.copyPaths = async clicked => {
            assert.strictEqual(clicked, second);
            boundary.clipboard.text = '/project/second.ts\n/project/first.ts';
        };

        const result = await TabSelection.resolve(second, boundary);

        assert.deepStrictEqual(result.map(uri => uri.toString()), [second.toString(), first.toString()]);
        assert.strictEqual(boundary.clipboard.text, 'previous clipboard');
    });

    test('Preserves remote schemes and authorities when Copy Path only returns paths', async () => {
        const first = vscode.Uri.parse('vscode-remote://ssh-remote+host/project/first.ts');
        const second = vscode.Uri.parse('vscode-remote://ssh-remote+host/project/second.ts');
        const boundary = selectionBoundary([first, second], '/project/first.ts\n/project/second.ts');

        const result = await TabSelection.resolve(first, boundary);

        assert.deepStrictEqual(result.map(uri => uri.toString()), [first.toString(), second.toString()]);
    });

    test('Matches Windows drive labels with configurable separators and preserves filename spaces', async () => {
        const first = vscode.Uri.parse('file:///c:/project/first.ts');
        const second = vscode.Uri.parse('file:///c:/project/ second.ts ');
        const boundary = selectionBoundary([first, second], 'C:\\project\\first.ts\r\nC:\\project\\ second.ts ');

        const result = await TabSelection.resolve(first, boundary);

        assert.deepStrictEqual(result.map(uri => uri.toString()), [first.toString(), second.toString()]);
    });

    test('Deduplicates a URI opened in multiple groups', async () => {
        const uri = vscode.Uri.file('/project/first.ts');
        const boundary = selectionBoundary([uri, uri], '/project/first.ts\n/project/first.ts');

        const result = await TabSelection.resolve(uri, boundary);

        assert.deepStrictEqual(result.map(item => item.toString()), [uri.toString()]);
    });

    test('Matches home-relative path labels to the known resource', async () => {
        const clicked = vscode.Uri.file('/Users/test/project/first.ts');
        const boundary = selectionBoundary([clicked], '~/project/first.ts');
        boundary.homePath = '/Users/test';

        const result = await TabSelection.resolve(clicked, boundary);

        assert.deepStrictEqual(result.map(uri => uri.toString()), [clicked.toString()]);
    });

    for (const [scenario, labels, candidates] of [
        ['unknown file', '/project/first.ts\n/project/not-open.ts', []],
        ['ambiguous remote authority', '/project/first.ts', ['vscode-remote://ssh-remote+other/project/first.ts']],
        ['missing clicked editor', '/project/second.ts', ['file:///project/second.ts']]
    ]) {
        test(`Rejects ${scenario} and restores the clipboard`, async () => {
            const clicked = vscode.Uri.file('/project/first.ts');
            const boundary = selectionBoundary([clicked, ...candidates.map(value => vscode.Uri.parse(value))], labels);

            await assert.rejects(TabSelection.resolve(clicked, boundary));

            assert.strictEqual(boundary.clipboard.text, 'previous clipboard');
        });
    }

    test('Restores the clipboard when Copy Path writes and then fails', async () => {
        const clicked = vscode.Uri.file('/project/first.ts');
        const boundary = selectionBoundary([clicked]);
        boundary.copyPaths = async () => {
            boundary.clipboard.text = '/project/first.ts';
            throw new Error('Copy Path failed');
        };

        await assert.rejects(TabSelection.resolve(clicked, boundary), /Copy Path failed/);

        assert.strictEqual(boundary.clipboard.text, 'previous clipboard');
    });

    test('Rejects an unchanged clipboard probe instead of copying the clicked tab alone', async () => {
        const clicked = vscode.Uri.file('/project/first.ts');
        const boundary = selectionBoundary([clicked], undefined, async () => {});

        await assert.rejects(TabSelection.resolve(clicked, boundary), /Could not determine/);

        assert.strictEqual(boundary.clipboard.text, 'previous clipboard');
    });

    test('Allows unselected non-text tabs alongside selected text tabs', async () => {
        const clicked = vscode.Uri.file('/project/first.ts');
        const boundary = selectionBoundary([clicked], '/project/first.ts');
        boundary.tabs.push({ input: new vscode.TabInputWebview('unselected.webview') });

        const result = await TabSelection.resolve(clicked, boundary);

        assert.deepStrictEqual(result.map(uri => uri.toString()), [clicked.toString()]);
    });

    test('Preserves direct copying of a clicked resource without a text tab input', async () => {
        const clicked = vscode.Uri.file('/project/image.png');
        const boundary = selectionBoundary([], '/project/image.png');
        boundary.tabs.push({ input: new vscode.TabInputCustom(clicked, 'image.preview') });

        const result = await TabSelection.resolve(clicked, boundary);

        assert.deepStrictEqual(result.map(uri => uri.toString()), [clicked.toString()]);
    });

    test('Resolves a real editor tab through VS Code Copy Path and restores the system clipboard', async () => {
        const clicked = vscode.Uri.file(path.join(__dirname, 'testWorkspace', 'app.js'));
        const previousText = await vscode.env.clipboard.readText();
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        try {
            await vscode.window.showTextDocument(clicked, { preview: false });

            const result = await TabSelection.resolve(clicked);

            assert.deepStrictEqual(result.map(uri => uri.toString()), [clicked.toString()]);
            assert.strictEqual(await vscode.env.clipboard.readText(), previousText);
        } finally {
            await vscode.env.clipboard.writeText(previousText);
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        }
    });
});
