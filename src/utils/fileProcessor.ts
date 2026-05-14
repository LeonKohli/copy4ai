import { TextDecoder } from 'util';
import * as vscode from 'vscode';
import { isBinaryFile } from 'isbinaryfile';
import type ignore from 'ignore';
import { FileContent, ProcessFileOptions } from '../types';
import { IgnoreUtils } from './ignoreUtils';
import { UriUtils } from './uriUtils';

export class FileProcessor {

    public static async processFile(
        fileUri: vscode.Uri,
        rootUri: vscode.Uri,
        ig: ignore.Ignore,
        options: ProcessFileOptions
    ): Promise<FileContent | null> {
        try {
            if (options.cancellationToken.isCancellationRequested) {
                throw new vscode.CancellationError();
            }

            const relativePath = UriUtils.relativePath(rootUri, fileUri);

            if (IgnoreUtils.isIgnored(ig, relativePath, false)) {
                return null;
            }

            if (options.isExcludedByResourcePath(fileUri)) {
                return null;
            }

            if (options.shouldExcludeContent(fileUri)) {
                return {
                    path: relativePath,
                    content: '[File content not included]'
                };
            }

            const stats = await vscode.workspace.fs.stat(fileUri);
            if (stats.size > options.maxFileSize) {
                return {
                    path: relativePath,
                    content: `[File too large: ${this.formatFileSize(stats.size)} > ${this.formatFileSize(options.maxFileSize)}]`
                };
            }

            const fileBytes = await vscode.workspace.fs.readFile(fileUri);
            const fileBuffer = Buffer.from(fileBytes);

            try {
                const isBinary = await isBinaryFile(fileBuffer, stats.size);
                if (isBinary) {
                    return {
                        path: relativePath,
                        content: '[Binary file content not included]'
                    };
                }
            } catch (error) {
                console.error(`Error checking if file is binary: ${fileUri.toString()}: ${error}`);
            }

            // Proactive encoding detection prevents the entire extension from crashing
            // when encountering UTF-16/UTF-32 files, which would otherwise cause
            // UTF-8 decoding to throw and halt processing
            const actualSample = fileBuffer.subarray(0, 1024);
            if (actualSample.length >= 2) {
                const firstBytes = actualSample.subarray(0, 4);

                // BOM detection based on Unicode standard specifications
                // See: https://unicode.org/faq/utf_bom.html#bom4
                if ((firstBytes[0] === 0xFF && firstBytes[1] === 0xFE) ||
                    (firstBytes[0] === 0xFE && firstBytes[1] === 0xFF) ||
                    (firstBytes.length >= 4 && firstBytes[0] === 0xFF && firstBytes[1] === 0xFE && firstBytes[2] === 0x00 && firstBytes[3] === 0x00) ||
                    (firstBytes.length >= 4 && firstBytes[0] === 0x00 && firstBytes[1] === 0x00 && firstBytes[2] === 0xFE && firstBytes[3] === 0xFF)) {
                    return {
                        path: relativePath,
                        content: '[File appears to be UTF-16 or UTF-32 encoded. Please convert to UTF-8 for inclusion.]'
                    };
                }

                // Heuristic: UTF-16 without BOM typically has many null bytes
                // This prevents treating UTF-16 text files as valid UTF-8
                const nullCount = actualSample.filter(byte => byte === 0).length;
                const nullRatio = nullCount / actualSample.length;

                if (nullRatio > 0.1) {
                    return {
                        path: relativePath,
                        content: '[File appears to have unsupported encoding. Please convert to UTF-8 for inclusion.]'
                    };
                }
            }

            try {
                let content = new TextDecoder('utf-8', { fatal: true }).decode(fileBuffer);
                content = this.processContent(content, options.removeComments, options.compressCode);

                return {
                    path: relativePath,
                    content
                };
            } catch (error) {
                // Graceful degradation: return error info instead of crashing the entire operation
                // This ensures other files can still be processed even if one file fails
                if (error instanceof TypeError || (error instanceof Error && 'code' in error && error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA')) {
                    return {
                        path: relativePath,
                        content: '[File has encoding issues. Please convert to UTF-8 for inclusion.]'
                    };
                }

                throw error;
            }

        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                throw error;
            }

            console.error(`Error processing file ${fileUri.toString()}:`, error);
            return {
                path: UriUtils.relativePath(rootUri, fileUri),
                content: `[Error reading file: ${error instanceof Error ? error.message : 'Unknown error'}]`
            };
        }
    }

    public static async processDirectory(
        dirUri: vscode.Uri,
        rootUri: vscode.Uri,
        ig: ignore.Ignore,
        options: ProcessFileOptions
    ): Promise<FileContent[]> {
        const results: FileContent[] = [];

        try {
            if (options.cancellationToken.isCancellationRequested) {
                throw new vscode.CancellationError();
            }

            // Check if the directory itself should be ignored before reading its contents
            // This prevents unnecessary file system operations on large ignored directories
            const relativeDirPath = UriUtils.relativePath(rootUri, dirUri);
            if (IgnoreUtils.isIgnored(ig, relativeDirPath, true)) {
                return results;
            }

            if (options.isExcludedByResourcePath(dirUri)) {
                return results;
            }

            const entries = await vscode.workspace.fs.readDirectory(dirUri);

            for (const [file, fileType] of entries) {
                if (options.cancellationToken.isCancellationRequested) {
                    throw new vscode.CancellationError();
                }

                const fileUri = vscode.Uri.joinPath(dirUri, file);

                if (fileType & vscode.FileType.Directory) {
                    const subResults = await this.processDirectory(fileUri, rootUri, ig, options);
                    results.push(...subResults);
                } else {
                    const fileContent = await this.processFile(fileUri, rootUri, ig, options);
                    if (fileContent) {
                        results.push(fileContent);
                    }
                }
            }
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                throw error;
            }

            console.error(`Error processing directory ${dirUri.toString()}:`, error);
        }

        return results;
    }



    public static removeCodeComments(content: string): string {
        return content
            // Order matters: block comments must be removed before line comments
            // to handle cases like /* comment */ followed by // comment on same line
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '');
    }

    public static compressCodeContent(content: string): string {
        return content
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .join('\n');
    }

    public static processContent(content: string, removeComments: boolean, compressCode: boolean): string {
        let processedContent = content;

        if (removeComments) {
            processedContent = this.removeCodeComments(processedContent);
        }

        if (compressCode) {
            processedContent = this.compressCodeContent(processedContent);
        }

        return processedContent;
    }

    private static formatFileSize(bytes: number): string {
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;

        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }

        return `${size.toFixed(1)} ${units[unitIndex]}`;
    }
}
