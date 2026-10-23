// src/lib/config/modelCatalog.ts
export type ModelCatalogEntry = {
  id: string;
  label: string;
  provider: string;
  defaultChecked: boolean;
  tags: string[];
};

/**
 * Current OpenRouter models, newest generation per provider (checked 2026-10-19).
 * Each provider has at most one "frontier" model; those are the judge candidates.
 */
export const MODEL_CATALOG: ModelCatalogEntry[] = [
    // OpenAI (3)
    { id: "openai/gpt-6-astra",        label: "GPT-6 Astra",        provider: "OpenAI",    defaultChecked: true,  tags: ["frontier", "reasoning"] },
    { id: "openai/gpt-6.1-sol",        label: "GPT-6.1 Sol",        provider: "OpenAI",    defaultChecked: true,  tags: ["strong", "value"] },
    { id: "openai/gpt-6-luna",         label: "GPT-6 Luna",         provider: "OpenAI",    defaultChecked: true,  tags: ["fast", "cheap"] },

    // Anthropic (4)
    { id: "anthropic/claude-opus-5.5",  label: "Claude Opus 5.5",    provider: "Anthropic", defaultChecked: true,  tags: ["frontier", "reasoning"] },
    { id: "anthropic/claude-fable-5.1", label: "Claude Fable 5.1",   provider: "Anthropic", defaultChecked: true,  tags: ["reasoning"] },
    { id: "anthropic/claude-sonnet-5.5",label: "Claude Sonnet 5.5",  provider: "Anthropic", defaultChecked: true,  tags: ["strong"] },
    { id: "anthropic/claude-haiku-5.5", label: "Claude Haiku 5.5",   provider: "Anthropic", defaultChecked: true,  tags: ["fast", "cheap"] },

    // Google (4)
    { id: "google/gemini-4-argon",      label: "Gemini 4 Argon",     provider: "Google",    defaultChecked: true,  tags: ["frontier", "reasoning"] },
    { id: "google/gemini-3.8-flash",    label: "Gemini 3.8 Flash",   provider: "Google",    defaultChecked: false, tags: ["fast", "value"] },
    { id: "google/gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", provider: "Google", defaultChecked: false, tags: ["fast", "cheap"] },
    { id: "google/gemini-3-flash-preview", label: "Gemini 3 Flash (preview)", provider: "Google", defaultChecked: false, tags: ["fast", "preview"] },

    // Meta (2)
    { id: "meta/muse-wonder",           label: "Muse Wonder",        provider: "Meta",      defaultChecked: false, tags: ["frontier", "reasoning"] },
    { id: "meta/muse-spark-1.3",        label: "Muse Spark 1.3",     provider: "Meta",      defaultChecked: false, tags: ["value"] },

    // SpaceXAI (1)
    { id: "x-ai/grok-4.7",              label: "Grok 4.7",           provider: "SpaceXAI",  defaultChecked: false, tags: ["strong"] },

    // DeepSeek (3)
    { id: "deepseek/deepseek-v4.1-flash-1017", label: "DeepSeek V4.1 Flash", provider: "DeepSeek", defaultChecked: false, tags: ["open", "value"] },
    { id: "deepseek/deepseek-v4-pro-0813",     label: "DeepSeek V4 Pro",     provider: "DeepSeek", defaultChecked: false, tags: ["open", "strong"] },
    { id: "deepseek/deepseek-v4-flash-0731",   label: "DeepSeek V4 Flash (0731)", provider: "DeepSeek", defaultChecked: false, tags: ["open", "cheap"] },

    // Other providers (6)
    { id: "mistralai/mistral-large-4-0", label: "Mistral Large 4",   provider: "Mistral",   defaultChecked: false, tags: ["strong"] },
    { id: "qwen/qwen3.8-max-0902",      label: "Qwen3.8 Max",        provider: "Alibaba",   defaultChecked: false, tags: ["strong"] },
    { id: "moonshotai/kimi-k3",         label: "Kimi K3",            provider: "Moonshot AI", defaultChecked: false, tags: ["open", "reasoning"] },
    { id: "z-ai/glm-5.3",               label: "GLM-5.3",            provider: "Z.ai",      defaultChecked: false, tags: ["open", "value"] },
    { id: "xiaomi/mimo-v2.6-pro",       label: "MiMo-V2.6-Pro",      provider: "Xiaomi",    defaultChecked: false, tags: ["open", "value"] },
    { id: "inception/mercury-3",        label: "Mercury 3",          provider: "Inception", defaultChecked: false, tags: ["fast", "diffusion"] },
];

/** Judge candidates: one frontier model per provider (GPT-6 Astra, Claude Opus 5.5, Gemini 4 Argon, Muse Wonder). */
export const JUDGE_MODELS = MODEL_CATALOG.filter((m) => m.tags.includes("frontier"));

/** Most judges a single run may use: one per frontier provider. */
export const MAX_JUDGES = 4;

/** Judges selected by default: all four, so no single provider's blind spots decide a score. */
export const DEFAULT_JUDGE_MODELS = JUDGE_MODELS.slice(0, MAX_JUDGES);
