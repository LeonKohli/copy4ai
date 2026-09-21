import * as vscode from 'vscode';

const STATUS_BAR_TIMEOUT = 5000;

export class CopyFeedbackReporter {

    /**
     * Confirms a finished copy in the status bar. A copy needs no decision from
     * the user, and VS Code asks extensions to keep those out of notifications.
     */
    public static report(message: string): void {
        vscode.window.setStatusBarMessage(`$(clippy) ${message}`, STATUS_BAR_TIMEOUT);
    }
}
