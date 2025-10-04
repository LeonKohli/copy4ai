import * as fs from 'fs/promises';
import * as path from 'path';

export class ProjectTreeGenerator {
    
    public static async generateProjectTree(
        dir: string,
        ig: any,
        maxDepth: number,
        currentDepth: number = 0,
        prefix: string = '',
        isExcludedByAbsolutePath: (filePath: string) => boolean,
        rootPath?: string
    ): Promise<string> {
        // Prevent infinite recursion and excessive memory usage on deep directory structures
        if (currentDepth > maxDepth) {
            return '';
        }

        // Initialize rootPath on first call
        if (!rootPath) {
            rootPath = dir;
        }

        try {
            // Check if directory should be ignored before reading its contents
            // This optimization prevents reading large ignored directories like node_modules
            if (currentDepth > 0) {
                const relativePath = path.relative(rootPath, dir);
                const relativePathPosix = relativePath.split(path.sep).join('/');
                if (relativePath && ig.ignores(relativePathPosix)) {
                    return '';
                }
                if (isExcludedByAbsolutePath(dir)) {
                    return '';
                }
            }
            
            const entries = await fs.readdir(dir, { withFileTypes: true });
            const visibleEntries: Array<{ name: string; isDirectory: boolean }> = [];

            for (const entry of entries) {
                const filePath = path.join(dir, entry.name);
                const rootRelative = path.relative(rootPath, filePath).split(path.sep).join('/');

                let isIgnored = false;
                let isExcludedByPath = false;

                try {
                    isIgnored = ig.ignores(rootRelative);
                } catch (error) {
                    console.error(`Error checking ignore pattern for ${rootRelative}: ${error}`);
                    isIgnored = false;
                }

                try {
                    isExcludedByPath = isExcludedByAbsolutePath(filePath);
                } catch (error) {
                    console.error(`Error checking path exclusion for ${filePath}: ${error}`);
                    isExcludedByPath = false;
                }

                if (!isIgnored && !isExcludedByPath) {
                    visibleEntries.push({ name: entry.name, isDirectory: entry.isDirectory() });
                }
            }

            if (visibleEntries.length === 0) {
                return '';
            }
            
            const sortedEntries = this.sortEntries(visibleEntries);
            
            let result = '';
            for (let i = 0; i < sortedEntries.length; i++) {
                const { name, isDirectory } = sortedEntries[i];
                const filePath = path.join(dir, name);
                const isLast = i === sortedEntries.length - 1;
                
                // Tree drawing characters follow standard CLI conventions
                // ├── for intermediate items, └── for last items in a branch
                const connector = isLast ? '└── ' : '├── ';
                const newPrefix = isLast ? '    ' : '│   ';

                result += prefix + connector + name + '\n';

                if (isDirectory) {
                    try {
                        const subTree = await this.generateProjectTree(
                            filePath,
                            ig,
                            maxDepth,
                            currentDepth + 1,
                            prefix + newPrefix,
                            isExcludedByAbsolutePath,
                            rootPath
                        );
                        result += subTree;
                    } catch (error) {
                        console.error(`Error processing ${filePath}:`, error);
                    }
                }
            }

            return result;
        } catch (error) {
            console.error(`Error reading directory ${dir}:`, error);
            return '';
        }
    }

    private static sortEntries(entries: Array<{ name: string; isDirectory: boolean }>): Array<{ name: string; isDirectory: boolean }> {
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
