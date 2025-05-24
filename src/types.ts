import * as vscode from 'vscode';

export interface Copy4AIOptions {
    readonly projectTreeOnly?: boolean;
    readonly includeProjectTree?: boolean;
    readonly useSelectedFolderAsRoot?: boolean;
}

export interface FileContent {
    readonly path: string;
    readonly content: string;
}

export interface ExcludeConfig {
    paths: string[];
    patterns: string[];
}

export interface ProcessedContent {
    projectTree: string;
    files: FileContent[];
}

export interface TokenInfo {
    inputTokens: number;
    cost: number;
}

export interface Copy4AIConfiguration {
    readonly ignoreGitIgnore: boolean;
    readonly ignoreDotFiles: boolean;
    readonly maxDepth: number;
    readonly excludePaths: ReadonlyArray<string>;
    readonly excludePatterns: ReadonlyArray<string>;
    readonly outputFormat: OutputFormat;
    readonly maxFileSize: number;
    readonly includeProjectTree: boolean;
    readonly compressCode: boolean;
    readonly removeComments: boolean;
    readonly llmModel: string;
    readonly maxTokens: number | null;
    readonly enableTokenWarning: boolean;
    readonly enableTokenCounting: boolean;
}

export interface ProcessFileOptions {
    maxFileSize: number;
    compressCode: boolean;
    removeComments: boolean;
    isExcludedByAbsolutePath: (filePath: string) => boolean;
}

export const SUPPORTED_MODELS = [
    'gpt-4',
    'gpt-4o', 
    'gpt-4o-mini',
    'claude-3-5-sonnet-20240620',
    'claude-3-opus-20240229'
] as const;

export type SupportedModel = typeof SUPPORTED_MODELS[number];

export const OUTPUT_FORMATS = ['plaintext', 'markdown', 'xml'] as const;
export type OutputFormat = typeof OUTPUT_FORMATS[number];

export const MODEL_MAX_TOKENS: Record<SupportedModel, number> = {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'gpt-4': 8192,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'gpt-4o': 128000,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'gpt-4o-mini': 128000,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'claude-3-5-sonnet-20240620': 200000,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'claude-3-opus-20240229': 200000
} as const;

export type ProgressReporter = vscode.Progress<{
    message?: string;
    increment?: number;
}>;

export type CancellationToken = vscode.CancellationToken; 