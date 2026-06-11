import * as vscode from 'vscode';

import { UriUtils } from './uriUtils';

// Minimal subset of the built-in git extension API
// (microsoft/vscode extensions/git/src/api/git.d.ts)
interface GitExtension {
    getAPI(version: 1): GitAPI;
}

export interface GitAPI {
    getRepository(uri: vscode.Uri): GitRepository | null;
}

export interface GitRepository {
    readonly rootUri: vscode.Uri;
    readonly state: {
        readonly mergeChanges: readonly GitChange[];
        readonly indexChanges: readonly GitChange[];
        readonly workingTreeChanges: readonly GitChange[];
        readonly untrackedChanges: readonly GitChange[];
    };
    diffWithHEAD(path: string): Promise<string>;
}

interface GitChange {
    readonly uri: vscode.Uri;
    readonly status: number;
}

// Values from the git extension's `const enum Status`
const STATUS_UNTRACKED = 7;
const STATUS_INTENT_TO_ADD = 9;

export class ScmChangesService {

    public static async getGitApi(): Promise<GitAPI> {
        const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
        if (!extension) {
            throw new Error('The built-in Git extension is not available');
        }

        const gitExtension = extension.isActive ? extension.exports : await extension.activate();
        return gitExtension.getAPI(1);
    }

    /**
     * Builds one concatenated unified diff (vs HEAD) for the given files.
     * Untracked files have no `git diff` output, so they are synthesized
     * as new-file diffs from their content.
     */
    public static async collectDiffs(api: GitAPI, uris: ReadonlyArray<vscode.Uri>): Promise<string> {
        const diffs: string[] = [];
        const unchanged: string[] = [];

        for (const uri of uris) {
            const repository = api.getRepository(uri);
            if (!repository) {
                throw new Error(`Not part of an open git repository: ${UriUtils.basename(uri)}`);
            }

            if (this.isUntracked(repository, uri)) {
                diffs.push(await this.buildUntrackedDiff(repository, uri));
                continue;
            }

            const diff = await repository.diffWithHEAD(uri.fsPath);
            if (diff.trim().length === 0) {
                unchanged.push(UriUtils.basename(uri));
                continue;
            }
            diffs.push(diff.replace(/\n$/, ''));
        }

        if (diffs.length === 0) {
            throw new Error(`No changes found for: ${unchanged.join(', ')}`);
        }

        return diffs.join('\n');
    }

    private static isUntracked(repository: GitRepository, uri: vscode.Uri): boolean {
        const changeLists = [
            repository.state.untrackedChanges,
            repository.state.workingTreeChanges
        ];

        for (const changes of changeLists) {
            const change = changes.find(c => c.uri.fsPath === uri.fsPath);
            if (change && (change.status === STATUS_UNTRACKED || change.status === STATUS_INTENT_TO_ADD)) {
                return true;
            }
        }

        return false;
    }

    private static async buildUntrackedDiff(repository: GitRepository, uri: vscode.Uri): Promise<string> {
        const relativePath = this.relativeToRepoRoot(repository, uri);
        const bytes = await vscode.workspace.fs.readFile(uri);
        const lines = [
            `diff --git a/${relativePath} b/${relativePath}`,
            'new file mode 100644'
        ];

        if (bytes.includes(0)) {
            lines.push(`Binary files /dev/null and b/${relativePath} differ`);
            return lines.join('\n');
        }

        lines.push('--- /dev/null', `+++ b/${relativePath}`);

        const content = new TextDecoder('utf-8').decode(bytes);
        if (content.length > 0) {
            const hasTrailingNewline = content.endsWith('\n');
            const contentLines = hasTrailingNewline ? content.slice(0, -1).split('\n') : content.split('\n');

            lines.push(`@@ -0,0 +1,${contentLines.length} @@`);
            for (const contentLine of contentLines) {
                lines.push('+' + contentLine);
            }
            if (!hasTrailingNewline) {
                lines.push('\\ No newline at end of file');
            }
        }

        return lines.join('\n');
    }

    private static relativeToRepoRoot(repository: GitRepository, uri: vscode.Uri): string {
        const rootPath = repository.rootUri.path.replace(/\/$/, '') + '/';
        return uri.path.startsWith(rootPath) ? uri.path.slice(rootPath.length) : UriUtils.basename(uri);
    }
}
