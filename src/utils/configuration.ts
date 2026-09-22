import * as vscode from 'vscode';
import { Copy4AIConfiguration, ExcludeConfig } from '../types';

// Mirrors the copy4ai.exclude default in package.json
const DEFAULT_EXCLUDE_PATTERNS = ['node_modules', '*.log'];

export class ConfigurationService {
    private static readonly configSection = 'copy4ai';

    public static getConfiguration(resource?: vscode.Uri): Copy4AIConfiguration {
        const config = vscode.workspace.getConfiguration(this.configSection, resource);
        
        return {
            ignoreGitIgnore: config.get('ignoreGitIgnore', true),
            ignoreDotFiles: config.get('ignoreDotFiles', true),
            maxDepth: config.get('maxDepth', 5),
            excludeContentPatterns: config.get('excludeContentPatterns', []),
            outputFormat: config.get('outputFormat', 'markdown'),
            maxFileSize: config.get('maxFileSize', 1024 * 1024),
            includeProjectTree: config.get('includeProjectTree', true),
            llmModel: config.get('llmModel', 'claude-sonnet-5'),
            maxTokens: config.get('maxTokens', null),
            enableTokenWarning: config.get('enableTokenWarning', true),
            enableTokenCounting: config.get('enableTokenCounting', false)
        };
    }

    public static getExcludeConfig(resource?: vscode.Uri): ExcludeConfig {
        const config = vscode.workspace.getConfiguration(this.configSection, resource);
        // A partially written object keeps the default for the missing half
        const exclude = config.get<Partial<ExcludeConfig>>('exclude');

        return {
            paths: Array.isArray(exclude?.paths) ? exclude.paths : [],
            patterns: Array.isArray(exclude?.patterns) ? exclude.patterns : DEFAULT_EXCLUDE_PATTERNS
        };
    }

    public static async updateConfiguration<K extends keyof Copy4AIConfiguration>(
        key: K,
        value: Copy4AIConfiguration[K],
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
