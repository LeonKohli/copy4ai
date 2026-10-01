const assert = require('assert');
const vscode = require('vscode');
const { UriUtils } = require('../out/utils/uriUtils');

suite('Clipboard resource paths', () => {
    test('Restores the workspace scheme and authority from an absolute display path', () => {
        const root = vscode.Uri.parse('vscode-remote://ssh-remote+host/project');
        const result = UriUtils.fromClipboardPath('/project/src/app.ts', [root], '/Users/test');

        assert.strictEqual(result.scheme, 'vscode-remote');
        assert.strictEqual(result.authority, 'ssh-remote+host');
        assert.strictEqual(result.path, '/project/src/app.ts');
    });

    test('Expands a home-relative label and preserves filename spaces', () => {
        const result = UriUtils.fromClipboardPath('~/project/ file.ts ', [], '/Users/test');

        assert.strictEqual(result.scheme, 'file');
        assert.strictEqual(result.path, '/Users/test/project/ file.ts ');
    });

    test('Preserves literal backslashes in POSIX filenames', function() {
        if (process.platform === 'win32') {
            this.skip();
        }
        const root = vscode.Uri.file('/project');
        const result = UriUtils.fromClipboardPath('/project/a\\b.txt', [root], '/Users/test');

        assert.strictEqual(result.path, '/project/a\\b.txt');
    });

    test('Keeps the scheme, authority, query and fragment of an explicit URI', () => {
        const value = 'custom://other/project/app.ts?revision=2#selection';
        const root = vscode.Uri.parse('vscode-remote://ssh-remote+host/project');

        const result = UriUtils.fromClipboardPath(value, [root], '/Users/test');

        assert.strictEqual(result.scheme, 'custom');
        assert.strictEqual(result.authority, 'other');
        assert.strictEqual(result.path, '/project/app.ts');
        assert.strictEqual(result.query, 'revision=2');
        assert.strictEqual(result.fragment, 'selection');
    });

    test('Rejects display paths shared by different workspace authorities', () => {
        const roots = [
            vscode.Uri.parse('vscode-remote://ssh-remote+first/project'),
            vscode.Uri.parse('vscode-remote://ssh-remote+second/project')
        ];

        assert.throws(() => UriUtils.fromClipboardPath('/project/app.ts', roots, '/Users/test'), /ambiguous/i);
    });

    test('Recovers a remote Windows drive path instead of treating the drive as a scheme', () => {
        const root = vscode.Uri.parse('vscode-remote://ssh-remote+host/c:/project');
        const result = UriUtils.fromClipboardPath('C:\\project\\ file.ts ', [root], '/Users/test');

        assert.strictEqual(result.scheme, 'vscode-remote');
        assert.strictEqual(result.authority, 'ssh-remote+host');
        assert.strictEqual(result.path, '/c:/project/ file.ts ');
    });

    test('Does not match a sibling whose name merely begins with the workspace path', () => {
        const root = vscode.Uri.parse('vscode-remote://ssh-remote+host/project');
        const result = UriUtils.fromClipboardPath('/project-other/app.ts', [root], '/Users/test');

        assert.strictEqual(result.scheme, 'file');
        assert.strictEqual(result.path, '/project-other/app.ts');
    });

    test('Overlapping roots in the same workspace recover the same URI without ambiguity', () => {
        const roots = [
            vscode.Uri.parse('vscode-remote://ssh-remote+host/project'),
            vscode.Uri.parse('vscode-remote://ssh-remote+host/project/src')
        ];
        const result = UriUtils.fromClipboardPath('/project/src/app.ts', roots, '/Users/test');

        assert.strictEqual(result.scheme, 'vscode-remote');
        assert.strictEqual(result.authority, 'ssh-remote+host');
        assert.strictEqual(result.path, '/project/src/app.ts');
    });
});
