import * as path from 'path';
import * as vscode from 'vscode';
import ignore from 'ignore';
import { UriUtils } from './uriUtils';

export class IgnoreUtils {

    public static createIgnoreInstance(patterns: string[] = [], ignoreDotFiles: boolean = true): ignore.Ignore {
        const ig = ignore().add(patterns);

        if (ignoreDotFiles) {
            // .* pattern excludes all dot files/directories (.git, .env, .vscode, etc.)
            // This is the default behavior most users expect when sharing code
            ig.add('.*');
        }

        return ig;
    }

    // Per gitignore spec, patterns ending in `/` (e.g. `build/`) match directories only.
    // The `ignore` lib needs a trailing slash on the checked path to recognize it as a dir.
    public static isIgnored(ig: ignore.Ignore, relativePath: string, isDirectory: boolean): boolean {
        if (!relativePath) {
            return false;
        }
        const posix = relativePath.split(path.sep).join('/');
        return ig.ignores(isDirectory ? posix + '/' : posix);
    }

    public static async addGitIgnoreRules(rootUri: vscode.Uri, ig: ignore.Ignore): Promise<void> {
        try {
            const gitIgnoreUri = vscode.Uri.joinPath(rootUri, '.gitignore');
            const gitIgnoreContent = await vscode.workspace.fs.readFile(gitIgnoreUri);
            ig.add(Buffer.from(gitIgnoreContent).toString('utf8'));
        } catch (error) {
            console.log('No .gitignore file found or unable to read it');
        }
    }

    public static createResourcePathExclusionFn(
        workspaceUri: vscode.Uri,
        pathsToExclude: ReadonlyArray<string> = []
    ): (resourceUri: vscode.Uri) => boolean {
        if (!pathsToExclude || pathsToExclude.length === 0) {
            return () => false;
        }

        const relativeExcludePaths: string[] = [];
        const absoluteFileExcludePaths: string[] = [];

        for (const excludePath of pathsToExclude) {
            const normalizedInput = excludePath.replace(/\\/g, '/').replace(/\/+$/, '');

            if (path.isAbsolute(excludePath) && workspaceUri.scheme === 'file') {
                absoluteFileExcludePaths.push(path.normalize(excludePath));
                continue;
            }

            relativeExcludePaths.push(
                normalizedInput
                    .replace(/^\.\//, '')
                    .replace(/^\/+/, '')
            );
        }

        return (resourceUri: vscode.Uri): boolean => {
            if (workspaceUri.scheme === 'file' && resourceUri.scheme === 'file') {
                const normalizedFilePath = path.normalize(resourceUri.fsPath);
                if (absoluteFileExcludePaths.some(excludePath =>
                    normalizedFilePath === excludePath ||
                    normalizedFilePath.startsWith(excludePath + path.sep)
                )) {
                    return true;
                }
            }

            let relativePath: string;
            try {
                relativePath = UriUtils.relativePath(workspaceUri, resourceUri);
            } catch (error) {
                return false;
            }

            return relativeExcludePaths.some(excludePath =>
                relativePath === excludePath ||
                relativePath.startsWith(`${excludePath}/`)
            );
        };
    }

    public static createResourceContentExclusionFn(
        workspaceUri: vscode.Uri,
        patterns: ReadonlyArray<string>
    ): (resourceUri: vscode.Uri) => boolean {
        if (!patterns || patterns.length === 0) {
            return () => false;
        }

        const ig = ignore().add(patterns as string[]);

        return (resourceUri: vscode.Uri): boolean => {
            try {
                const relativePath = UriUtils.relativePath(workspaceUri, resourceUri);
                return ig.ignores(relativePath);
            } catch (error) {
                return false;
            }
        };
    }
}
