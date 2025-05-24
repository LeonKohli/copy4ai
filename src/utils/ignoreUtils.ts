import * as fs from 'fs/promises';
import * as path from 'path';
import ignore from 'ignore';

export class IgnoreUtils {
    
    public static createIgnoreInstance(patterns: string[] = [], ignoreDotFiles: boolean = true): any {
        const ig = ignore().add(patterns);
        
        if (ignoreDotFiles) {
            ig.add('.*');
        }
        
        return ig;
    }

    public static async addGitIgnoreRules(rootPath: string, ig: any): Promise<void> {
        try {
            const gitIgnorePath = path.join(rootPath, '.gitignore');
            const gitIgnoreContent = await fs.readFile(gitIgnorePath, 'utf8');
            ig.add(gitIgnoreContent);
        } catch (error) {
            // .gitignore file doesn't exist or can't be read, which is fine
            console.log('No .gitignore file found or unable to read it');
        }
    }

    public static createAbsolutePathExclusionFn(
        workspacePath: string,
        absolutePathsToExclude: string[] = []
    ): (filePath: string) => boolean {
        if (!absolutePathsToExclude || absolutePathsToExclude.length === 0) {
            return () => false;
        }

        const normalizedExcludePaths = absolutePathsToExclude.map(excludePath => {
            // Normalize the path and ensure it's relative to workspace
            const normalizedPath = path.normalize(excludePath);
            
            // Convert to absolute path relative to workspace
            const absolutePath = path.isAbsolute(normalizedPath) 
                ? normalizedPath 
                : path.join(workspacePath, normalizedPath);
            
            return path.normalize(absolutePath);
        });

        return (filePath: string): boolean => {
            const normalizedFilePath = path.normalize(filePath);
            
            return normalizedExcludePaths.some(excludePath => {
                // Check if the file path starts with the exclude path
                return normalizedFilePath.startsWith(excludePath + path.sep) || 
                       normalizedFilePath === excludePath;
            });
        };
    }
} 