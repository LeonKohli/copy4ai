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
                if (relativePath && ig.ignores(relativePath)) {
                    return '';
                }
                if (isExcludedByAbsolutePath(dir)) {
                    return '';
                }
            }
            
            const files = await fs.readdir(dir);
            const visibleFiles: string[] = [];

            for (const file of files) {
                const filePath = path.join(dir, file);
                const relativePath = path.relative(dir, filePath);

                let isIgnored = false;
                let isExcludedByPath = false;

                try {
                    isIgnored = ig.ignores(relativePath);
                } catch (error) {
                    console.error(`Error checking ignore pattern for ${relativePath}: ${error}`);
                    isIgnored = false;
                }

                try {
                    isExcludedByPath = isExcludedByAbsolutePath(filePath);
                } catch (error) {
                    console.error(`Error checking path exclusion for ${filePath}: ${error}`);
                    isExcludedByPath = false;
                }

                if (!isIgnored && !isExcludedByPath) {
                    visibleFiles.push(file);
                }
            }

            if (visibleFiles.length === 0) {
                return '';
            }

            const sortedFiles = await this.sortFiles(dir, visibleFiles);
            
            let result = '';
            for (let i = 0; i < sortedFiles.length; i++) {
                const file = sortedFiles[i];
                const filePath = path.join(dir, file);
                const isLast = i === sortedFiles.length - 1;
                
                // Tree drawing characters follow standard CLI conventions
                // ├── for intermediate items, └── for last items in a branch
                const connector = isLast ? '└── ' : '├── ';
                const newPrefix = isLast ? '    ' : '│   ';

                result += prefix + connector + file + '\n';

                try {
                    const stats = await fs.stat(filePath);
                    if (stats.isDirectory()) {
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
                    }
                } catch (error) {
                    console.error(`Error processing ${filePath}:`, error);
                }
            }

            return result;
        } catch (error) {
            console.error(`Error reading directory ${dir}:`, error);
            return '';
        }
    }

    private static async sortFiles(dir: string, files: string[]): Promise<string[]> {
        const fileInfo: Array<{ name: string; isDirectory: boolean }> = [];

        for (const file of files) {
            try {
                const filePath = path.join(dir, file);
                const stats = await fs.stat(filePath);
                fileInfo.push({
                    name: file,
                    isDirectory: stats.isDirectory()
                });
            } catch (error) {
                console.error(`Error getting stats for ${file}:`, error);
                fileInfo.push({
                    name: file,
                    isDirectory: false
                });
            }
        }

        // Standard file explorer behavior: directories first, then files, both alphabetical
        // This matches user expectations from most operating systems and file managers
        return fileInfo
            .sort((a, b) => {
                if (a.isDirectory && !b.isDirectory) {
                    return -1;
                }
                if (!a.isDirectory && b.isDirectory) {
                    return 1;
                }
                return a.name.localeCompare(b.name);
            })
            .map(item => item.name);
    }
} 