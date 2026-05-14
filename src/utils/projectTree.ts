import * as vscode from 'vscode';
import type ignore from 'ignore';
import { IgnoreUtils } from './ignoreUtils';
import { UriUtils } from './uriUtils';

export class ProjectTreeGenerator {
    
    public static async generateProjectTree(
        dir: vscode.Uri,
        ig: ignore.Ignore,
        maxDepth: number,
        currentDepth: number = 0,
        prefix: string = '',
        isExcludedByResourcePath: (resourceUri: vscode.Uri) => boolean,
        cancellationToken: vscode.CancellationToken,
        rootUri?: vscode.Uri
    ): Promise<string> {
        if (cancellationToken.isCancellationRequested) {
            throw new vscode.CancellationError();
        }

        // Prevent infinite recursion and excessive memory usage on deep directory structures
        if (currentDepth > maxDepth) {
            return '';
        }

        if (!rootUri) {
            rootUri = dir;
        }

        try {
            // Check if directory should be ignored before reading its contents
            // This optimization prevents reading large ignored directories like node_modules
            if (currentDepth > 0) {
                const relativePath = UriUtils.relativePath(rootUri, dir);
                if (IgnoreUtils.isIgnored(ig, relativePath, true)) {
                    return '';
                }
                if (isExcludedByResourcePath(dir)) {
                    return '';
                }
            }
            
            const entries = await vscode.workspace.fs.readDirectory(dir);
            const visibleEntries: Array<{ name: string; isDirectory: boolean; uri: vscode.Uri }> = [];

            for (const [name, fileType] of entries) {
                if (cancellationToken.isCancellationRequested) {
                    throw new vscode.CancellationError();
                }

                const fileUri = vscode.Uri.joinPath(dir, name);
                const isDirectory = Boolean(fileType & vscode.FileType.Directory);
                const rootRelative = UriUtils.relativePath(rootUri, fileUri);

                let isIgnored = false;
                let isExcludedByPath = false;

                try {
                    isIgnored = IgnoreUtils.isIgnored(ig, rootRelative, isDirectory);
                } catch (error) {
                    console.error(`Error checking ignore pattern for ${rootRelative}: ${error}`);
                    isIgnored = false;
                }

                try {
                    isExcludedByPath = isExcludedByResourcePath(fileUri);
                } catch (error) {
                    console.error(`Error checking path exclusion for ${fileUri.toString()}: ${error}`);
                    isExcludedByPath = false;
                }

                if (!isIgnored && !isExcludedByPath) {
                    visibleEntries.push({ name, isDirectory, uri: fileUri });
                }
            }

            if (visibleEntries.length === 0) {
                return '';
            }
            
            const sortedEntries = this.sortEntries(visibleEntries);
            
            let result = '';
            for (let i = 0; i < sortedEntries.length; i++) {
                if (cancellationToken.isCancellationRequested) {
                    throw new vscode.CancellationError();
                }

                const { name, isDirectory, uri } = sortedEntries[i];
                const isLast = i === sortedEntries.length - 1;

                const connector = isLast ? '└── ' : '├── ';
                const newPrefix = isLast ? '    ' : '│   ';

                result += prefix + connector + name + '\n';

                if (isDirectory) {
                    try {
                        const subTree = await this.generateProjectTree(
                            uri,
                            ig,
                            maxDepth,
                            currentDepth + 1,
                            prefix + newPrefix,
                            isExcludedByResourcePath,
                            cancellationToken,
                            rootUri
                        );
                        result += subTree;
                    } catch (error) {
                        if (error instanceof vscode.CancellationError) {
                            throw error;
                        }

                        console.error(`Error processing ${uri.toString()}:`, error);
                    }
                }
            }

            return result;
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                throw error;
            }

            console.error(`Error reading directory ${dir.toString()}:`, error);
            return '';
        }
    }

    private static sortEntries<T extends { name: string; isDirectory: boolean }>(entries: T[]): T[] {
        // Standard file explorer behavior: directories first, then files, both alphabetical
        return entries.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) {
                return -1;
            }
            if (!a.isDirectory && b.isDirectory) {
                return 1;
            }
            return a.name.localeCompare(b.name);
        });
    }
} 
