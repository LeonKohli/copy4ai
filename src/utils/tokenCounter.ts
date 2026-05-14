import * as vscode from 'vscode';
import { countTokens as countTokensO200k } from 'gpt-tokenizer/cjs/encoding/o200k_base';
import { countTokens as countTokensCl100k } from 'gpt-tokenizer/cjs/encoding/cl100k_base';
import { countTokens as countTokensAnthropic } from '@anthropic-ai/tokenizer';

import { TokenInfo, TokenCountMethod } from '../types';
import { detectFamily, resolveModel } from './modelRegistry';

interface TokenizerSelection {
    readonly count: (text: string) => number;
    readonly method: TokenCountMethod;
    readonly approximate: boolean;
}

// Pick the most accurate tokenizer available for the model name.
// Tokenizers are model-family specific. Using the wrong one can mis-count by
// 1.5x-2x (tiktoken on Claude underestimates dramatically per Anthropic's own
// docs and claude-code issue #22506).
function selectTokenizer(model: string): TokenizerSelection {
    const family = detectFamily(model);
    const m = model.trim().toLowerCase();

    if (family === 'anthropic') {
        // Anthropic's legacy tokenizer is the best off-line approximation for
        // Claude 3+ (~1-2% MAPE per published studies). Exact counts require
        // their free /v1/messages/count_tokens endpoint (rate-limited, no
        // token cost — see https://docs.anthropic.com/en/api/token-counting).
        return {
            count: (text) => countTokensAnthropic(text),
            method: 'anthropic-legacy',
            approximate: true
        };
    }

    if (family === 'openai') {
        // o200k_base is the encoding for GPT-5/4o/4.1/o1/o3/o4/chatgpt-*.
        // cl100k_base is for the older GPT-4/3.5 line.
        const isLegacyGpt = (m.startsWith('gpt-4') && !m.startsWith('gpt-4o') && !m.startsWith('gpt-4.1'))
            || m.startsWith('gpt-3.5');
        if (isLegacyGpt) {
            return {
                count: (text) => countTokensCl100k(text),
                method: 'openai-cl100k',
                approximate: false
            };
        }
        return {
            count: (text) => countTokensO200k(text),
            method: 'openai-o200k',
            approximate: false
        };
    }

    // Everything else (Gemini, Grok, DeepSeek, Llama, Mistral, unknown): no
    // first-party tokenizer ships with this extension. Fall back to the rough
    // 4-chars-per-token heuristic and label the count as such.
    return {
        count: (text) => Math.ceil(text.length / 4),
        method: 'chars-heuristic',
        approximate: true
    };
}

const METHOD_LABEL: Record<TokenCountMethod, string> = {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'openai-o200k': 'exact',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'openai-cl100k': 'exact',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'anthropic-legacy': 'approx - Claude tokenizer',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'chars-heuristic': 'approx - chars/4 heuristic'
};

function buildMessage(info: TokenInfo, format: string): string {
    const approxMark = info.approximate ? '~' : '';
    return `Copied to clipboard: ${format} format, ${approxMark}${info.inputTokens.toLocaleString()} tokens (${METHOD_LABEL[info.method]})`;
}

export class TokenCounter {

    public static countTokens(content: string, model: string): TokenInfo {
        const tokenizer = selectTokenizer(model);
        const inputTokens = tokenizer.count(content);
        const info = resolveModel(model);

        return {
            inputTokens,
            method: tokenizer.method,
            approximate: tokenizer.approximate,
            maxInputTokens: info ? info.maxInputTokens : null
        };
    }

    public static async showTokenInfo(
        content: string,
        model: string,
        format: string,
        enableWarning: boolean,
        maxTokens: number | null
    ): Promise<void> {
        try {
            const info = this.countTokens(content, model);
            let message = buildMessage(info, format);

            if (!enableWarning) {
                vscode.window.showInformationMessage(message);
                return;
            }

            // Use user's explicit limit when set, otherwise fall back to the
            // model's registered context window. Zero means "disabled".
            const tokenLimit = maxTokens !== null && maxTokens > 0
                ? maxTokens
                : (info.maxInputTokens ?? 0);

            if (tokenLimit > 0 && info.inputTokens > tokenLimit) {
                message += `\nWARNING: Token count (${info.inputTokens.toLocaleString()}) exceeds the limit (${tokenLimit.toLocaleString()}).`;
                const selection = await vscode.window.showWarningMessage(
                    message,
                    'OK',
                    'Reduce Token Count'
                );
                if (selection === 'Reduce Token Count') {
                    await vscode.commands.executeCommand(
                        'workbench.action.openSettings',
                        'copy4ai.compressCode'
                    );
                }
            } else {
                vscode.window.showInformationMessage(message);
            }
        } catch (error) {
            console.error('Error in token counting:', error);
            // Don't let token counting failures hide the fact that the copy
            // itself succeeded. That's the core feature.
            vscode.window.showInformationMessage(`Copied to clipboard: ${format} format`);
        }
    }

    public static getModelMaxTokens(model: string): number {
        const info = resolveModel(model);
        return info ? info.maxInputTokens : 0;
    }
}
