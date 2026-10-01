import * as path from 'path';
import * as vscode from 'vscode';

export class UriUtils {
    public static fromClipboardPath(
        value: string,
        workspaceUris: readonly vscode.Uri[],
        homePath: string
    ): vscode.Uri {
        const isDrivePath = /^[A-Za-z]:[\\/]/.test(value);
        if (!isDrivePath && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) {
            return vscode.Uri.parse(value);
        }

        const expandedPath = value.startsWith('~/')
            ? `${homePath.replace(/[\\/]+$/, '')}/${value.slice(2)}`
            : value;
        const normalizedPath = this.normalizeClipboardPath(expandedPath);
        const matches = new Map<string, vscode.Uri>();

        for (const root of workspaceUris) {
            for (const label of [root.fsPath, root.path]) {
                const normalizedRoot = this.trimTrailingSlash(this.normalizeClipboardPath(label));
                const prefix = normalizedRoot.endsWith('/') ? normalizedRoot : `${normalizedRoot}/`;
                let relativePath: string;
                if (normalizedPath === normalizedRoot) {
                    relativePath = '';
                } else if (normalizedPath.startsWith(prefix)) {
                    relativePath = normalizedPath.slice(prefix.length);
                } else {
                    continue;
                }
                const resource = vscode.Uri.joinPath(root, relativePath);
                matches.set(resource.toString(), resource);
            }
        }

        if (matches.size > 1) {
            throw new Error('The selected file path is ambiguous between workspace folders.');
        }
        const matchedResource = matches.values().next().value;
        return matchedResource ?? vscode.Uri.file(expandedPath);
    }

    public static relativePath(rootUri: vscode.Uri, resourceUri: vscode.Uri): string {
        if (rootUri.scheme === 'file' && resourceUri.scheme === 'file') {
            return path.relative(rootUri.fsPath, resourceUri.fsPath).split(path.sep).join('/');
        }

        if (rootUri.scheme !== resourceUri.scheme || rootUri.authority !== resourceUri.authority) {
            throw new Error(`Resource ${resourceUri.toString()} is not in the same file system as ${rootUri.toString()}`);
        }

        const rootPath = this.trimTrailingSlash(rootUri.path);
        const resourcePath = this.trimTrailingSlash(resourceUri.path);

        if (resourcePath === rootPath) {
            return '';
        }

        const prefix = rootPath.endsWith('/') ? rootPath : `${rootPath}/`;
        if (!resourcePath.startsWith(prefix)) {
            throw new Error(`Resource ${resourceUri.toString()} is outside ${rootUri.toString()}`);
        }

        return resourcePath.slice(prefix.length);
    }

    public static basename(resourceUri: vscode.Uri): string {
        return path.posix.basename(this.trimTrailingSlash(resourceUri.path));
    }

    private static normalizeClipboardPath(value: string): string {
        const usesWindowsSeparators = process.platform === 'win32' ||
            /^\/?[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\');
        return path.posix.normalize(usesWindowsSeparators ? value.replace(/\\/g, '/') : value)
            .replace(/^\/(?=[A-Za-z]:\/)/, '')
            .replace(/^[a-z](?=:\/)/, drive => drive.toUpperCase());
    }

    private static trimTrailingSlash(value: string): string {
        if (value === '/') {
            return value;
        }

        return value.replace(/\/+$/, '');
    }
}
