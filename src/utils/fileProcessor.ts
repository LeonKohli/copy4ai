import * as fs from 'fs/promises';
import * as path from 'path';
import { isBinaryFile } from 'isbinaryfile';
import { FileContent, ProcessFileOptions } from '../types';

export class FileProcessor {
    
    public static async processFile(
        filePath: string,
        rootPath: string,
        ig: any,
        options: ProcessFileOptions
    ): Promise<FileContent | null> {
        try {
            const relativePath = path.relative(rootPath, filePath);
            
            if (ig.ignores(relativePath)) {
                return null;
            }
            
            if (options.isExcludedByAbsolutePath(filePath)) {
                return null;
            }

            const stats = await fs.stat(filePath);
            if (stats.size > options.maxFileSize) {
                return {
                    path: relativePath,
                    content: `[File too large: ${this.formatFileSize(stats.size)} > ${this.formatFileSize(options.maxFileSize)}]`
                };
            }

            try {
                const isBinary = await isBinaryFile(filePath);
                if (isBinary) {
                    return {
                        path: relativePath,
                        content: '[Binary file content not included]'
                    };
                }
            } catch (error) {
                console.error(`Error checking if file is binary: ${filePath}: ${error}`);
            }
            
            // Proactive encoding detection prevents the entire extension from crashing
            // when encountering UTF-16/UTF-32 files, which would otherwise cause
            // fs.readFile to throw ERR_ENCODING_INVALID_ENCODED_DATA and halt processing
            try {
                const fileHandle = await fs.open(filePath, 'r');
                const sampleBuffer = Buffer.alloc(1024);
                const { bytesRead } = await fileHandle.read(sampleBuffer, 0, 1024, 0);
                await fileHandle.close();
                const actualSample = sampleBuffer.subarray(0, bytesRead);
                
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
            } catch (error) {
                console.error(`Error during encoding detection for ${filePath}: ${error}`);
            }
            
            try {
                let content = await fs.readFile(filePath, 'utf8');
                content = this.processContent(content, options.removeComments, options.compressCode);
                
                return {
                    path: relativePath,
                    content
                };
            } catch (error) {
                // Graceful degradation: return error info instead of crashing the entire operation
                // This ensures other files can still be processed even if one file fails
                if (error instanceof Error && 'code' in error && error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA') {
                    return {
                        path: relativePath,
                        content: '[File has encoding issues. Please convert to UTF-8 for inclusion.]'
                    };
                }
                
                throw error;
            }
            
        } catch (error) {
            console.error(`Error processing file ${filePath}:`, error);
            return {
                path: path.relative(rootPath, filePath),
                content: `[Error reading file: ${error instanceof Error ? error.message : 'Unknown error'}]`
            };
        }
    }
    
    public static async processDirectory(
        dirPath: string,
        rootPath: string,
        ig: any,
        options: ProcessFileOptions
    ): Promise<FileContent[]> {
        const results: FileContent[] = [];
        
        try {
            const files = await fs.readdir(dirPath);
            
            for (const file of files) {
                const filePath = path.join(dirPath, file);
                const stats = await fs.stat(filePath);
                
                if (stats.isDirectory()) {
                    const subResults = await this.processDirectory(filePath, rootPath, ig, options);
                    results.push(...subResults);
                } else {
                    const fileContent = await this.processFile(filePath, rootPath, ig, options);
                    if (fileContent) {
                        results.push(fileContent);
                    }
                }
            }
        } catch (error) {
            console.error(`Error processing directory ${dirPath}:`, error);
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