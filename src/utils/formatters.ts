import { FileContent, OutputFormat } from '../types';

export class OutputFormatter {
    
    public static formatOutput(
        format: OutputFormat,
        projectTree: string,
        content: ReadonlyArray<FileContent>
    ): string {
        switch (format) {
            case 'markdown':
                return this.formatMarkdown(projectTree, content);
            case 'xml':
                return this.formatXML(projectTree, content);
            case 'plaintext':
            default:
                return this.formatPlainText(projectTree, content);
        }
    }

    public static formatProjectStructureOnly(
        format: OutputFormat,
        projectTree: string
    ): string {
        switch (format) {
            case 'markdown':
                return `# Project Structure\n\n\`\`\`\n${projectTree}\`\`\`\n`;
            case 'xml':
                return `<?xml version="1.0" encoding="UTF-8"?>\n<copy4ai>\n` +
                    `  <project_structure>\n` +
                    projectTree.split('\n')
                        .map(line => '    ' + this.escapeXML(line))
                        .join('\n') +
                    `\n  </project_structure>\n</copy4ai>`;
            case 'plaintext':
            default:
                return `Project Structure:\n\n${projectTree}\n`;
        }
    }

    private static formatMarkdown(projectTree: string, content: ReadonlyArray<FileContent>): string {
        let output = '';
        
        if (projectTree) {
            output += '# Project Structure\n\n```\n' + projectTree + '```\n\n';
        }
        
        if (content.length > 0) {
            output += '# File Contents\n\n';
            for (const file of content) {
                const fileExtension = this.getFileExtension(file.path);
                output += `## ${file.path}\n\n\`\`\`${fileExtension}\n${file.content}\n\`\`\`\n\n`;
            }
        }
        
        return output;
    }

    private static formatPlainText(projectTree: string, content: ReadonlyArray<FileContent>): string {
        let output = '';
        
        if (projectTree) {
            output += 'Project Structure:\n\n' + projectTree + '\n\n';
        }
        
        if (content.length > 0) {
            output += 'File Contents:\n\n';
            for (const file of content) {
                output += `--- ${file.path} ---\n${file.content}\n\n`;
            }
        }
        
        return output;
    }

    private static formatXML(projectTree: string, content: ReadonlyArray<FileContent>): string {
        let output = '<?xml version="1.0" encoding="UTF-8"?>\n<copy4ai>\n';
        
        if (projectTree) {
            output += '  <project_structure>\n';
            output += projectTree.split('\n')
                .map(line => '    ' + this.escapeXML(line))
                .join('\n');
            output += '\n  </project_structure>\n';
        }
        
        if (content.length > 0) {
            output += '  <file_contents>\n';
            for (const file of content) {
                output += `    <file path="${this.escapeXML(file.path)}">\n`;
                output += '      <![CDATA[' + file.content + ']]>\n';
                output += '    </file>\n';
            }
            output += '  </file_contents>\n';
        }
        
        output += '</copy4ai>';
        return output;
    }

    private static getFileExtension(filePath: string): string {
        const parts = filePath.split('.');
        // If there's no dot in the filename, or the dot is at the beginning (like .gitignore), 
        // there's no extension
        if (parts.length <= 1 || parts[parts.length - 1] === '') {
            return '';
        }
        
        const ext = parts.pop()?.toLowerCase();
        
        // Map common extensions to syntax highlighting identifiers
        const extensionMap: Record<string, string> = {
            'js': 'javascript',
            'ts': 'typescript',
            'jsx': 'jsx',
            'tsx': 'tsx',
            'py': 'python',
            'rb': 'ruby',
            'go': 'go',
            'rs': 'rust',
            'php': 'php',
            'java': 'java',
            'c': 'c',
            'cpp': 'cpp',
            'cs': 'csharp',
            'html': 'html',
            'css': 'css',
            'scss': 'scss',
            'sass': 'sass',
            'less': 'less',
            'json': 'json',
            'xml': 'xml',
            'yaml': 'yaml',
            'yml': 'yaml',
            'md': 'markdown',
            'sh': 'bash',
            'ps1': 'powershell',
            'sql': 'sql',
            'dockerfile': 'dockerfile'
        };

        return ext ? (extensionMap[ext] || ext) : '';
    }

    private static escapeXML(unsafe: string): string {
        return unsafe
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
} 