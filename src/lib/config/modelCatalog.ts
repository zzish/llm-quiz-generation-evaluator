// src/lib/config/modelCatalog.ts
export type ModelCatalogEntry = {
  id: string;
  label: string;
  provider: string;
  defaultChecked: boolean;
  tags: string[];
};

export const MODEL_CATALOG: ModelCatalogEntry[] = [
    // OpenAI (5)
    { id: "openai/gpt-5.2",            label: "GPT-5.2",            provider: "OpenAI",    defaultChecked: true,  tags: ["frontier", "reasoning"] },
    { id: "openai/gpt-5-mini",         label: "GPT-5 Mini",         provider: "OpenAI",    defaultChecked: true,  tags: ["fast", "cheap"] },
    { id: "openai/gpt-4.1",            label: "GPT-4.1",            provider: "OpenAI",    defaultChecked: true,  tags: ["strong", "reliable"] },
    { id: "openai/gpt-4o",             label: "GPT-4o",             provider: "OpenAI",    defaultChecked: true,  tags: ["multimodal", "general"] },
    { id: "openai/o3",                 label: "o3",                 provider: "OpenAI",    defaultChecked: true,  tags: ["reasoning"] },
  
    // Anthropic (4)
    { id: "anthropic/claude-opus-4.1",  label: "Claude Opus 4.1",    provider: "Anthropic", defaultChecked: true,  tags: ["frontier", "reasoning"] },
    { id: "anthropic/claude-sonnet-4.5",label: "Claude Sonnet 4.5",  provider: "Anthropic", defaultChecked: true,  tags: ["coding"] },
    { id: "anthropic/claude-sonnet-4",  label: "Claude Sonnet 4",    provider: "Anthropic", defaultChecked: true,  tags: ["strong"] },
    { id: "anthropic/claude-3.7-sonnet",label: "Claude 3.7 Sonnet",  provider: "Anthropic", defaultChecked: true,  tags: ["strong", "value"] },
  
    // Google (4)
    { id: "google/gemini-3-pro-preview",label: "Gemini 3 Pro (preview)", provider: "Google", defaultChecked: true,  tags: ["frontier", "multimodal", "preview"] },
    { id: "google/gemini-3-flash-preview", label: "Gemini 3 Flash (preview)", provider: "Google", defaultChecked: false, tags: ["fast", "preview"] },
    { id: "google/gemini-2.5-pro",      label: "Gemini 2.5 Pro",     provider: "Google",    defaultChecked: false, tags: ["strong"] },
    { id: "google/gemini-2.5-flash",    label: "Gemini 2.5 Flash",   provider: "Google",    defaultChecked: false, tags: ["fast", "value"] },
  
    // Mistral (4)
    { id: "mistralai/mistral-large",    label: "Mistral Large",      provider: "Mistral",   defaultChecked: false, tags: ["strong"] },
    { id: "mistralai/mistral-medium-3.1",label:"Mistral Medium 3.1", provider: "Mistral",   defaultChecked: false, tags: ["value"] },
    { id: "mistralai/mistral-small-3.1-24b-instruct", label: "Mistral Small 3.1 24B", provider: "Mistral", defaultChecked: false, tags: ["cheap", "solid"] },
    { id: "mistralai/mixtral-8x22b-instruct", label: "Mixtral 8x22B Instruct", provider: "Mistral", defaultChecked: false, tags: ["open", "moe"] },
  
    // Meta (3)
    { id: "meta-llama/llama-4-maverick",label: "Llama 4 Maverick",   provider: "Meta",      defaultChecked: false, tags: ["open", "moe"] },
    { id: "meta-llama/llama-4-scout",   label: "Llama 4 Scout",      provider: "Meta",      defaultChecked: false, tags: ["open"] },
    { id: "meta-llama/llama-3.1-405b-instruct", label: "Llama 3.1 405B Instruct", provider: "Meta", defaultChecked: false, tags: ["open", "huge"] },
];

/** Frontier models for judging (GPT-5.2, Claude Opus 4.1, Gemini 3 Pro); default-select all 3 in the UI. */
export const JUDGE_MODELS = MODEL_CATALOG.filter((m) => m.tags.includes("frontier"));
