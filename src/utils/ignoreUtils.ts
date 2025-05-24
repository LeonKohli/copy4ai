import * as fs from 'fs/promises';
import * as path from 'path';
import ignore from 'ignore';

export class IgnoreUtils {
    
    public static createIgnoreInstance(patterns: string[] = [], ignoreDotFiles: boolean = true): any {
        const ig = ignore().add(patterns);
        
        if (ignoreDotFiles) {
            // .* pattern excludes all dot files/directories (.git, .env, .vscode, etc.)
            // This is the default behavior most users expect when sharing code
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
            console.log('No .gitignore file found or unable to read it');
        }
    }

    public static createAbsolutePathExclusionFn(
        workspacePath: string,
        absolutePathsToExclude: string[] = []
    ): (filePath: string) => boolean {
        if (!absolutePathsToExclude || absolutePathsToExclude.length === 0) {
            // Performance optimization: return no-op function when no exclusions configured
            return () => false;
        }

        const normalizedExcludePaths = absolutePathsToExclude.map(excludePath => {
            const normalizedPath = path.normalize(excludePath);
            
            // Support both absolute and relative paths in configuration
            // Relative paths are resolved against workspace root for consistency
            const absolutePath = path.isAbsolute(normalizedPath) 
                ? normalizedPath 
                : path.join(workspacePath, normalizedPath);
            
            return path.normalize(absolutePath);
        });

        return (filePath: string): boolean => {
            const normalizedFilePath = path.normalize(filePath);
            
            return normalizedExcludePaths.some(excludePath => {
                // Match both exact paths and subdirectories
                // e.g., excluding "src/config" also excludes "src/config/secrets.json"
                return normalizedFilePath.startsWith(excludePath + path.sep) || 
                       normalizedFilePath === excludePath;
            });
        };
    }
} 