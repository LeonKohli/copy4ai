import * as vscode from 'vscode';
import { tokenizeAndEstimateCost } from 'llm-cost';
import { TokenInfo, MODEL_MAX_TOKENS, SupportedModel } from '../types';

export class TokenCounter {
    
    public static async countTokensAndEstimateCost(
        content: string,
        model: string
    ): Promise<TokenInfo> {
        try {
            const result = await tokenizeAndEstimateCost({
                model,
                input: content,
                output: ''
            });
            
            return {
                inputTokens: result.inputTokens || 0,
                cost: result.cost || 0
            };
        } catch (error) {
            console.error('Error counting tokens:', error);
            throw new Error(`Failed to count tokens: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public static async showTokenInfo(
        content: string,
        model: string,
        format: string,
        enableWarning: boolean,
        maxTokens: number | null
    ): Promise<void> {
        try {
            const { inputTokens, cost } = await this.countTokensAndEstimateCost(content, model);
            
            let message = `Copied to clipboard: ${format} format, ${inputTokens} tokens, $${cost.toFixed(4)} est. cost`;

            if (enableWarning) {
                // Use custom limit if set, otherwise fall back to model's context window limit
                // This helps users avoid hitting API limits or performance issues with large inputs
                const tokenLimit = maxTokens !== null ? maxTokens : (MODEL_MAX_TOKENS[model as keyof typeof MODEL_MAX_TOKENS] || 0);
                
                if (tokenLimit > 0 && inputTokens > tokenLimit) {
                    message += `\nWARNING: Token count (${inputTokens}) exceeds the set limit (${tokenLimit}).`;
                    
                    const selection = await vscode.window.showWarningMessage(
                        message,
                        'OK',
                        'Reduce Token Count'
                    );
                    
                    // Provide actionable solution: direct link to compression settings
                    if (selection === 'Reduce Token Count') {
                        await vscode.commands.executeCommand(
                            'workbench.action.openSettings',
                            'copy4ai.compressCode'
                        );
                    }
                } else {
                    vscode.window.showInformationMessage(message);
                }
            } else {
                vscode.window.showInformationMessage(message);
            }
        } catch (error) {
            console.error('Error in token counting:', error);
            // Graceful fallback: show basic success message if token counting fails
            // Don't let token counting errors prevent the core functionality from working
            vscode.window.showInformationMessage(`Copied to clipboard: ${format} format`);
        }
    }

    public static getModelMaxTokens(model: string): number {
        return MODEL_MAX_TOKENS[model as keyof typeof MODEL_MAX_TOKENS] || 0;
    }
} 