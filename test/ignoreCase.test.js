const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const vscode = require('vscode');
const { IgnoreUtils, FileProcessor, ProjectTreeGenerator } = require('../out/extension');

suite('Ignore Pattern Case (issue #33)', () => {
    test('Configured exclusion patterns distinguish filename and directory case', () => {
        const ig = IgnoreUtils.createIgnoreInstance(['*.BASE.*', 'Build/'], false);

        assert.strictEqual(IgnoreUtils.isIgnored(ig, 'tsconfig.base.json', false), false);
        assert.strictEqual(IgnoreUtils.isIgnored(ig, 'tsconfig.BASE.json', false), true);
        assert.strictEqual(IgnoreUtils.isIgnored(ig, 'build', true), false);
        assert.strictEqual(IgnoreUtils.isIgnored(ig, 'Build', true), true);
    });

    test('Content exclusions distinguish filename case for remote URIs', () => {
        const root = vscode.Uri.parse('vscode-remote://ssh-remote+test/project');
        const excludesContent = IgnoreUtils.createResourceContentExclusionFn(root, ['*.BASE.*']);

        assert.strictEqual(excludesContent(vscode.Uri.joinPath(root, 'tsconfig.base.json')), false);
        assert.strictEqual(excludesContent(vscode.Uri.joinPath(root, 'tsconfig.BASE.json')), true);
    });

    test('Gitignore rules keep differently cased files in both the tree and copied content', async () => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copy4ai-ignore-case-'));
        const root = vscode.Uri.file(directory);
        const tokenSource = new vscode.CancellationTokenSource();
        try {
            await fs.mkdir(path.join(directory, 'lower'));
            await fs.mkdir(path.join(directory, 'upper'));
            await fs.writeFile(path.join(directory, '.gitignore'), '*.BASE.*\n');
            await fs.writeFile(path.join(directory, 'lower', 'tsconfig.base.json'), '{"included":true}');
            await fs.writeFile(path.join(directory, 'upper', 'tsconfig.BASE.json'), '{"included":false}');
            const ig = IgnoreUtils.createIgnoreInstance([], true);
            await IgnoreUtils.addGitIgnoreRules(root, ig);
            const isExcludedByResourcePath = IgnoreUtils.createResourcePathExclusionFn(root, []);

            const tree = await ProjectTreeGenerator.generateProjectTree(
                root, ig, 5, 0, '', isExcludedByResourcePath, tokenSource.token
            );
            assert.ok(tree.includes('tsconfig.base.json'), 'Tree should include the lower-case file');
            assert.ok(!tree.includes('tsconfig.BASE.json'), 'Tree should omit the matching upper-case file');

            const files = await FileProcessor.processDirectory(root, root, ig, {
                maxFileSize: 1024,
                isExcludedByResourcePath,
                shouldExcludeContent: IgnoreUtils.createResourceContentExclusionFn(root, []),
                cancellationToken: tokenSource.token
            });
            assert.deepStrictEqual(files, [
                { path: 'lower/tsconfig.base.json', content: '{"included":true}' }
            ]);
        } finally {
            tokenSource.dispose();
            await fs.rm(directory, { recursive: true, force: true });
        }
    });
});
