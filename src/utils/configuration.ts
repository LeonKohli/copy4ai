import * as vscode from 'vscode';
import { Copy4AIConfiguration, ExcludeConfig } from '../types';

export class ConfigurationService {
    private static readonly configSection = 'copy4ai';

    public static getConfiguration(): Copy4AIConfiguration {
        const config = vscode.workspace.getConfiguration(this.configSection);
        
        return {
            ignoreGitIgnore: config.get('ignoreGitIgnore', true),
            ignoreDotFiles: config.get('ignoreDotFiles', true),
            maxDepth: config.get('maxDepth', 5),
            excludePaths: config.get('excludePaths', []),
            excludePatterns: config.get('excludePatterns', ['node_modules', '*.log']),
            outputFormat: config.get('outputFormat', 'markdown'),
            maxFileSize: config.get('maxFileSize', 1024 * 1024),
            includeProjectTree: config.get('includeProjectTree', true),
            compressCode: config.get('compressCode', false),
            removeComments: config.get('removeComments', false),
            llmModel: config.get('llmModel', 'gpt-4o'),
            maxTokens: config.get('maxTokens', null),
            enableTokenWarning: config.get('enableTokenWarning', true),
            enableTokenCounting: config.get('enableTokenCounting', false)
        };
    }

    public static getExcludeConfig(): ExcludeConfig {
        const config = vscode.workspace.getConfiguration(this.configSection);
        // Preferred structured configuration
        const structured = config.get<{ paths?: string[]; patterns?: string[] }>('exclude');
        if (structured && (Array.isArray(structured.paths) || Array.isArray(structured.patterns))) {
            return {
                paths: Array.isArray(structured.paths) ? structured.paths : [],
                patterns: Array.isArray(structured.patterns) ? structured.patterns : ['node_modules', '*.log']
            };
        }

        // Legacy flat arrays
        const excludePaths = config.get<string[]>('excludePaths');
        const excludePatterns = config.get<string[]>('excludePatterns');
        if (Array.isArray(excludePaths) || Array.isArray(excludePatterns)) {
            return {
                paths: Array.isArray(excludePaths) ? excludePaths : [],
                patterns: Array.isArray(excludePatterns) ? excludePatterns : ['node_modules', '*.log']
            };
        }

        // Default fallback
        return {
            paths: [],
            patterns: ['node_modules', '*.log']
        };
    }

    public static async updateConfiguration(
        key: keyof Copy4AIConfiguration,
        value: any,
        target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global
    ): Promise<void> {
        const config = vscode.workspace.getConfiguration(this.configSection);
        await config.update(key, value, target);
    }

    public static async toggleProjectTree(): Promise<void> {
        const config = this.getConfiguration();
        const newValue = !config.includeProjectTree;
        
        await this.updateConfiguration('includeProjectTree', newValue);
        
        const status = newValue ? 'enabled' : 'disabled';
        vscode.window.showInformationMessage(`Project tree is now ${status} when copying code.`);
    }

    public static async toggleDotFiles(): Promise<void> {
        const config = this.getConfiguration();
        const newValue = !config.ignoreDotFiles;
        
        await this.updateConfiguration('ignoreDotFiles', newValue);
        
        const status = newValue ? 'ignored' : 'included';
        vscode.window.showInformationMessage(`Dot files (.github, etc.) will now be ${status} when copying code.`);
    }
} 
