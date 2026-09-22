import * as vscode from 'vscode';

import { ExcludeConfig } from '../types';

interface LegacyScope {
    readonly target: vscode.ConfigurationTarget;
    readonly resource?: vscode.Uri;
    readonly read: <T>(inspected?: LegacyInspection<T>) => T | undefined;
}

interface LegacyInspection<T> {
    globalValue?: T;
    workspaceValue?: T;
    workspaceFolderValue?: T;
}

export class SettingsMigration {

    /**
     * Rewrites `copy4ai.excludePaths` and `copy4ai.excludePatterns` into
     * `copy4ai.exclude` and removes them. Reading both forever is not an option:
     * the Settings editor hides deprecated settings, so a user whose exclusions
     * come from the old keys cannot see where the value comes from.
     */
    public static async migrateLegacyExclusions(): Promise<void> {
        for (const scope of this.legacyScopes()) {
            const config = vscode.workspace.getConfiguration('copy4ai', scope.resource);
            const paths = scope.read(config.inspect<string[]>('excludePaths'));
            const patterns = scope.read(config.inspect<string[]>('excludePatterns'));

            if (paths === undefined && patterns === undefined) {
                continue;
            }

            const existing = scope.read(config.inspect<Partial<ExcludeConfig>>('exclude'));
            if (existing === undefined) {
                await config.update('exclude', {
                    paths: paths ?? [],
                    patterns: patterns ?? []
                }, scope.target);
            }

            await config.update('excludePaths', undefined, scope.target);
            await config.update('excludePatterns', undefined, scope.target);
        }
    }

    private static legacyScopes(): LegacyScope[] {
        const scopes: LegacyScope[] = [
            { target: vscode.ConfigurationTarget.Global, read: inspected => inspected?.globalValue }
        ];

        // Workspace files belong to whoever opened them; editing them without
        // trust is exactly what Restricted Mode exists to prevent.
        if (!vscode.workspace.isTrusted) {
            return scopes;
        }

        scopes.push({
            target: vscode.ConfigurationTarget.Workspace,
            read: inspected => inspected?.workspaceValue
        });

        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            scopes.push({
                target: vscode.ConfigurationTarget.WorkspaceFolder,
                resource: folder.uri,
                read: inspected => inspected?.workspaceFolderValue
            });
        }

        return scopes;
    }
}
