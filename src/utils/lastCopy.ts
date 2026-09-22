import * as vscode from 'vscode';

// Gates the Command Palette entry: before the first copy there is nothing to repeat
const HAS_LAST_COPY_CONTEXT_KEY = 'copy4ai.hasLastCopy';

export class LastCopyStore {

    private static items: ReadonlyArray<vscode.Uri> = [];

    /**
     * Remembers a finished copy so it can be repeated. Memory only: a reload
     * ends the task the selection belonged to, and it keeps a selection from
     * outliving the workspace it was made in.
     */
    public static async remember(items: ReadonlyArray<vscode.Uri>): Promise<void> {
        this.items = items;
        await vscode.commands.executeCommand('setContext', HAS_LAST_COPY_CONTEXT_KEY, items.length > 0);
    }

    public static get(): ReadonlyArray<vscode.Uri> {
        return this.items;
    }
}
