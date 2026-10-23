/**
 * Every model the batch runner may call directly: which provider serves it, the name that provider
 * expects, the reasoning levels it accepts, and what it costs.
 *
 * Reasoning levels come from each provider's own documentation, read 2026-10-19/20:
 * - Anthropic (models overview and effort guide): Opus 5.5 always thinks, effort `low`…`max`; Haiku 5.5 effort
 *   `low`…`max`.
 * - OpenAI and Azure (reasoning guides): GPT-6 Astra and GPT-6.1 Sol have no `none`; Luna has. On Azure,
 *   `max` works only through the Responses API, which is why GPT models use it here.
 * - Google (thinking guide): Gemini 4 Argon and 3.8 Flash take `low`, `medium`, `high`; 3 Flash `low`, `high`.
 * - Meta (reasoning guide): Muse Wonder takes `minimal`…`max`; `none` returns 400.
 * - Inception (chat completions reference): Mercury 3 takes `instant`, `low`, `medium`, `high`.
 * - DeepSeek (thinking mode guide): thinking on or off; effort `low`, `high`, `max`. Here `off` means off.
 *
 * Prices are US dollars per million tokens. Anthropic's come from its model table; Azure's from the Azure
 * Global list prices (and Microsoft's announcement for DeepSeek V4.1); the rest are the OpenRouter list prices
 * of 2026-10-19, which pass each provider's own price through. Every cost reported here is a list price.
 */
import type { CallUsage, ProviderId } from "./types.js";

/** Dollars per million tokens. */
export interface Pricing {
	input: number;
	output: number;
	cachedInput: number;
}

/** One directly callable model. */
export interface ModelEntry {
	key: string;
	provider: ProviderId;
	/** The model or deployment name the provider expects in the request. */
	apiModel: string;
	label: string;
	/** Reasoning levels this model accepts, cheapest first. */
	levels: readonly string[];
	pricing: Pricing;
	/** Azure only: the API this deployment is called through. */
	azureApi?: "responses" | "chat";
}

const ENTRIES: ModelEntry[] = [
	{ key: "anthropic:claude-opus-5-5", provider: "anthropic", apiModel: "claude-opus-5-5", label: "Claude Opus 5.5", levels: ["low", "medium", "high", "xhigh", "max"], pricing: { input: 4, output: 20, cachedInput: 0.2 } },
	{ key: "anthropic:claude-haiku-5-5", provider: "anthropic", apiModel: "claude-haiku-5-5", label: "Claude Haiku 5.5", levels: ["low", "medium", "high", "xhigh", "max"], pricing: { input: 0.1, output: 0.5, cachedInput: 0.01 } },
	{ key: "azure:gpt-6-astra", provider: "azure", apiModel: "gpt-6-astra", label: "GPT-6 Astra", levels: ["low", "medium", "high", "xhigh", "max"], pricing: { input: 10, output: 50, cachedInput: 1 }, azureApi: "responses" },
	{ key: "azure:gpt-6.1-sol", provider: "azure", apiModel: "gpt-6.1-sol", label: "GPT-6.1 Sol", levels: ["low", "medium", "high", "xhigh", "max"], pricing: { input: 2, output: 10, cachedInput: 0.1 }, azureApi: "responses" },
	{ key: "azure:gpt-6-luna", provider: "azure", apiModel: "gpt-6-luna", label: "GPT-6 Luna", levels: ["none", "low", "medium", "high", "xhigh", "max"], pricing: { input: 0.1, output: 0.5, cachedInput: 0.01 }, azureApi: "responses" },
	{ key: "azure:DeepSeek-V4.1-Flash", provider: "azure", apiModel: "DeepSeek-V4.1-Flash", label: "DeepSeek V4.1 Flash (Azure)", levels: ["none", "low", "high", "max"], pricing: { input: 0.3, output: 1.2, cachedInput: 0.006 }, azureApi: "chat" },
	{ key: "google:gemini-4-argon", provider: "google", apiModel: "gemini-4-argon", label: "Gemini 4 Argon", levels: ["low", "medium", "high"], pricing: { input: 2, output: 10, cachedInput: 0.1 } },
	{ key: "google:gemini-3.8-flash", provider: "google", apiModel: "gemini-3.8-flash", label: "Gemini 3.8 Flash", levels: ["low", "medium", "high"], pricing: { input: 0.825, output: 4.125, cachedInput: 0.0825 } },
	{ key: "google:gemini-3-flash-preview", provider: "google", apiModel: "gemini-3-flash-preview", label: "Gemini 3 Flash (preview)", levels: ["low", "high"], pricing: { input: 0.5, output: 3, cachedInput: 0.05 } },
	{ key: "meta:muse-wonder-1.0", provider: "meta", apiModel: "muse-wonder-1.0", label: "Muse Wonder", levels: ["minimal", "low", "medium", "high", "xhigh", "max"], pricing: { input: 4, output: 20, cachedInput: 0.2 } },
	{ key: "inception:mercury-3", provider: "inception", apiModel: "mercury-3", label: "Mercury 3", levels: ["instant", "low", "medium", "high"], pricing: { input: 0.1, output: 0.35, cachedInput: 0.01 } },
	{ key: "deepseek:deepseek-flash", provider: "deepseek", apiModel: "deepseek-flash", label: "DeepSeek V4.1 Flash (DeepSeek)", levels: ["off", "low", "high", "max"], pricing: { input: 0.15, output: 0.6, cachedInput: 0.003 } },
];

/** The registry, keyed by `provider:model`. */
export const MODEL_REGISTRY: ReadonlyMap<string, ModelEntry> = new Map(ENTRIES.map((entry) => [entry.key, entry]));

/**
 * The entry for a registry key, checked against the reasoning level it will be called with.
 *
 * Throws on an unknown key or an unsupported level, so a typo in a run's configuration fails before any
 * money is spent rather than as a provider error halfway through.
 */
export function resolveModel(modelKey: string, reasoning: string): ModelEntry {
	const entry = MODEL_REGISTRY.get(modelKey);
	if (!entry) {
		throw new Error(`Unknown model "${modelKey}". Known: ${[...MODEL_REGISTRY.keys()].join(", ")}`);
	}
	if (!entry.levels.includes(reasoning)) {
		throw new Error(`${entry.label} has no reasoning level "${reasoning}". Allowed: ${entry.levels.join(", ")}`);
	}
	return entry;
}

/**
 * The list-price cost of one call in US dollars.
 *
 * `batch` applies the 50% discount Anthropic's Message Batches API gives on input and output alike.
 */
export function costUsd(entry: ModelEntry, usage: CallUsage, options: { batch?: boolean } = {}): number {
	const uncachedInput = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
	const dollars =
		(uncachedInput * entry.pricing.input + usage.cachedInputTokens * entry.pricing.cachedInput + usage.outputTokens * entry.pricing.output) /
		1_000_000;
	return options.batch ? dollars / 2 : dollars;
}
