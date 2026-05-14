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

// Tokenization method actually used for the count. Surfaced to the user so
// they can judge how trustworthy the number is.
//   - openai-o200k:     exact (gpt-tokenizer) for GPT-5/4o/4.1/o-series
//   - openai-cl100k:    exact (gpt-tokenizer) for GPT-4/3.5
//   - anthropic-legacy: approximation (~1-2% MAPE per published studies) for
//                       Claude. Exact counts are only available via the free
//                       /v1/messages/count_tokens API (rate-limited)
//   - chars-heuristic:  4-chars-per-token rough fallback for unknown families
export type TokenCountMethod =
    | 'openai-o200k'
    | 'openai-cl100k'
    | 'anthropic-legacy'
    | 'chars-heuristic';

export interface TokenInfo {
    readonly inputTokens: number;
    readonly method: TokenCountMethod;
    readonly approximate: boolean;
    readonly maxInputTokens: number | null;
}

export interface Copy4AIConfiguration {
    readonly ignoreGitIgnore: boolean;
    readonly ignoreDotFiles: boolean;
    readonly maxDepth: number;
    readonly excludePaths: ReadonlyArray<string>;
    readonly excludePatterns: ReadonlyArray<string>;
    readonly excludeContentPatterns: ReadonlyArray<string>;
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
    isExcludedByResourcePath: (resourceUri: vscode.Uri) => boolean;
    shouldExcludeContent: (resourceUri: vscode.Uri) => boolean;
    cancellationToken: vscode.CancellationToken;
}

export const OUTPUT_FORMATS = ['plaintext', 'markdown', 'xml'] as const;
export type OutputFormat = typeof OUTPUT_FORMATS[number];

export type ProgressReporter = vscode.Progress<{
    message?: string;
    increment?: number;
}>;

export type CancellationToken = vscode.CancellationToken;
