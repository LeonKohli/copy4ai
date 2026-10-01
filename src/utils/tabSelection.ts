import * as vscode from 'vscode';
import { homedir } from 'os';

export interface TabSelectionBoundary {
    readonly clipboard: vscode.Clipboard;
    readonly tabs: ReadonlyArray<{ readonly input: unknown }>;
    readonly homePath?: string;
    copyPaths(uri: vscode.Uri): Thenable<unknown>;
}

export class TabSelection {
    public static async resolve(
        clickedUri: vscode.Uri,
        boundary: TabSelectionBoundary = {
            clipboard: vscode.env.clipboard,
            tabs: vscode.window.tabGroups.all.flatMap(group => group.tabs),
            homePath: homedir(),
            copyPaths: uri => vscode.commands.executeCommand('copyFilePath', uri)
        }
    ): Promise<vscode.Uri[]> {
        const previousText = await boundary.clipboard.readText();
        const sentinel = `copy4ai-tab-selection:${Date.now()}:${Math.random()}`;
        let copiedText = sentinel;

        // Tab menus omit selection; copyFilePath resolves it with the clicked URI.
        // https://github.com/microsoft/vscode/blob/1.140.0/src/vs/workbench/contrib/files/browser/files.ts#L154-L170
        await boundary.clipboard.writeText(sentinel);
        try {
            try {
                await boundary.copyPaths(clickedUri);
            } finally {
                copiedText = await boundary.clipboard.readText();
            }

            if (copiedText === sentinel || copiedText === '') {
                throw new Error('Could not determine the selected editor tabs');
            }

            return this.matchPaths(copiedText, clickedUri, boundary.tabs, boundary.homePath);
        } finally {
            const currentText = await boundary.clipboard.readText();
            if (currentText === sentinel || currentText === copiedText) {
                await boundary.clipboard.writeText(previousText);
            }
        }
    }

    private static matchPaths(
        copiedText: string,
        clickedUri: vscode.Uri,
        tabs: ReadonlyArray<{ readonly input: unknown }>,
        homePath?: string
    ): vscode.Uri[] {
        const candidates = new Map<string, Map<string, vscode.Uri>>();
        const uris = [clickedUri, ...tabs.flatMap(tab =>
            tab.input instanceof vscode.TabInputText ? [tab.input.uri] : [])];
        for (const uri of uris) {
            // Copy Path returns display labels, which can omit remote schemes and
            // authorities. Match known URIs instead of constructing local file URIs.
            const labels = [uri.fsPath, uri.path, uri.toString(), uri.toString(true)];
            if (homePath && uri.fsPath.startsWith(`${homePath}/`)) {
                labels.push(`~${uri.fsPath.slice(homePath.length)}`);
            }
            for (const label of labels) {
                const key = this.normalizePathLabel(label);
                const matches = candidates.get(key) ?? new Map<string, vscode.Uri>();
                matches.set(uri.toString(), uri);
                candidates.set(key, matches);
            }
        }

        const result = new Map<string, vscode.Uri>();
        for (const label of copiedText.split(/\r?\n/)) {
            const matches = candidates.get(this.normalizePathLabel(label));
            if (!matches || matches.size !== 1) {
                throw new Error('Could not identify all selected text tabs from their file paths');
            }
            const uri = matches.values().next().value;
            if (uri) {
                result.set(uri.toString(), uri);
            }
        }

        if (!result.has(clickedUri.toString())) {
            throw new Error('The selected tab paths do not include the clicked editor');
        }

        return Array.from(result.values());
    }

    private static normalizePathLabel(label: string): string {
        const windowsPath = process.platform === 'win32' || /^\/?[A-Za-z]:[\\/]/.test(label) || label.startsWith('\\\\');
        return (windowsPath ? label.replace(/\\/g, '/') : label)
            .replace(/^\/(?=[A-Za-z]:\/)/, '')
            .replace(/^[a-z](?=:\/)/, drive => drive.toUpperCase());
    }
}
