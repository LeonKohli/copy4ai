// Curated model registry.
//
// Powers two things:
//   1. Tokenizer selection (via `family`) when the heuristic in detectFamily
//      isn't enough.
//   2. The "token count exceeds limit" warning threshold (via maxInputTokens).
//
// Tokenization itself works for ANY model name. Unknown models fall through
// to detectFamily's prefix logic and the chars/4 heuristic.
//
// Lookup is prefix-based — typing "claude-opus-4-7-20260416" still resolves
// to the canonical "claude-opus-4-7" entry. Order of registry keys does not
// matter; resolveModel() sorts keys by length descending so the most specific
// prefix wins (e.g. "gpt-5-codex" before "gpt-5", "gpt-5.5" before "gpt-5").
//
// Refresh whenever a listed family's flagship moves or a new mainstream
// model ships. Source of truth for context windows:
// https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json
// Last refresh: 2026-05 — verified against Anthropic, OpenAI, Google docs.

export type ModelFamily = 'openai' | 'anthropic' | 'google' | 'meta' | 'xai' | 'deepseek' | 'mistral' | 'unknown';

export interface ModelInfo {
    readonly maxInputTokens: number;
    readonly family: ModelFamily;
}

// Property names are wire-format model IDs from providers (kebab-case, dotted
// versions, single letters). Camel-casing them would defeat prefix lookup.
/* eslint-disable @typescript-eslint/naming-convention */
export const MODEL_REGISTRY: Readonly<Record<string, ModelInfo>> = {
    // ─── Anthropic: Claude 4.x (current frontier) ──────────────────────
    // Opus 4.6 and 4.7 default to 1M context in the API; Sonnet 4.6 has 1M
    // in beta but ships 200K by default.
    'claude-opus-4-7': { maxInputTokens: 1000000, family: 'anthropic' },
    'claude-opus-4-6': { maxInputTokens: 1000000, family: 'anthropic' },
    'claude-opus-4-5': { maxInputTokens: 200000, family: 'anthropic' },
    'claude-sonnet-4-6': { maxInputTokens: 1000000, family: 'anthropic' },
    'claude-sonnet-4-5': { maxInputTokens: 200000, family: 'anthropic' },
    'claude-haiku-4-5': { maxInputTokens: 200000, family: 'anthropic' },

    // ─── Anthropic: Claude 3.x (still actively used) ───────────────────
    'claude-3-7-sonnet': { maxInputTokens: 200000, family: 'anthropic' },
    'claude-3-5-sonnet': { maxInputTokens: 200000, family: 'anthropic' },

    // ─── OpenAI: GPT-5 series ──────────────────────────────────────────
    // GPT-5.5 ships with a 1M-token context window in the API.
    'gpt-5.5': { maxInputTokens: 1000000, family: 'openai' },
    'gpt-5.4': { maxInputTokens: 400000, family: 'openai' },
    'gpt-5.3': { maxInputTokens: 400000, family: 'openai' },
    'gpt-5-codex': { maxInputTokens: 400000, family: 'openai' },
    'gpt-5': { maxInputTokens: 400000, family: 'openai' },

    // ─── OpenAI: o-series reasoning ────────────────────────────────────
    'o4-mini': { maxInputTokens: 200000, family: 'openai' },
    'o3': { maxInputTokens: 200000, family: 'openai' },

    // ─── OpenAI: GPT-4 line (legacy, still in use) ─────────────────────
    'gpt-4.1': { maxInputTokens: 1047576, family: 'openai' },
    'gpt-4o': { maxInputTokens: 128000, family: 'openai' },

    // ─── Google: Gemini 3.x (current flagship) ─────────────────────────
    'gemini-3-pro': { maxInputTokens: 1048576, family: 'google' },
    'gemini-3-flash': { maxInputTokens: 1048576, family: 'google' },

    // ─── Google: Gemini 2.5 (still GA) ─────────────────────────────────
    'gemini-2.5-pro': { maxInputTokens: 2000000, family: 'google' },
    'gemini-2.5-flash': { maxInputTokens: 1000000, family: 'google' },

    // ─── Others ────────────────────────────────────────────────────────
    'grok-4': { maxInputTokens: 256000, family: 'xai' },
    'deepseek-v4': { maxInputTokens: 128000, family: 'deepseek' },
    'deepseek-r1': { maxInputTokens: 128000, family: 'deepseek' }
};
/* eslint-enable @typescript-eslint/naming-convention */

// Prefix-match order: longest key first so "gpt-5-codex" wins over "gpt-5",
// "claude-opus-4-7" wins over a hypothetical "claude-opus" entry, etc.
const SORTED_KEYS = Object.keys(MODEL_REGISTRY).sort((a, b) => b.length - a.length);

export function resolveModel(model: string): ModelInfo | undefined {
    const normalized = model.trim().toLowerCase();
    if (MODEL_REGISTRY[normalized]) {
        return MODEL_REGISTRY[normalized];
    }
    for (const key of SORTED_KEYS) {
        if (normalized.startsWith(key)) {
            return MODEL_REGISTRY[key];
        }
    }
    return undefined;
}

export function detectFamily(model: string): ModelFamily {
    const resolved = resolveModel(model);
    if (resolved) {
        return resolved.family;
    }
    const m = model.trim().toLowerCase();
    if (m.startsWith('claude')) { return 'anthropic'; }
    if (m.startsWith('gpt-') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4') || m.startsWith('chatgpt')) {
        return 'openai';
    }
    if (m.startsWith('gemini')) { return 'google'; }
    if (m.startsWith('grok')) { return 'xai'; }
    if (m.startsWith('deepseek')) { return 'deepseek'; }
    if (m.startsWith('llama')) { return 'meta'; }
    if (m.startsWith('mistral') || m.startsWith('mixtral')) { return 'mistral'; }
    return 'unknown';
}
