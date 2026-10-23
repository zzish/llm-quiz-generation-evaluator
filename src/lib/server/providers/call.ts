/**
 * Calls a model through its provider's own API and returns the shared result shape.
 *
 * Claude goes through the official Anthropic SDK, streamed so a long `max`-effort answer cannot hit an
 * HTTP timeout. The OpenAI-compatible providers (Azure, Meta, Inception, DeepSeek) go through the official
 * OpenAI SDK. Gemini goes through its REST endpoint, with its own retry, because Google's limits answer
 * with 429s that say how long to wait. The SDKs retry 408/409/429/5xx themselves.
 */
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { costUsd, resolveModel } from "./registry.js";
import type { ModelEntry } from "./registry.js";
import { anthropicParams, chatParams, fromAnthropic, fromChat, fromGemini, fromResponses, geminiBody, responsesParams } from "./requests.js";
import type { GeminiResponse } from "./requests.js";
import type { CallResult, ModelCall } from "./types.js";

/** Long enough for a `max`-effort judge answer; a call that runs past it is abandoned and retried. */
const CALL_TIMEOUT_MS = 20 * 60 * 1000;
const SDK_RETRIES = 4;
const GEMINI_RETRIES = 6;

/** One client per provider whose key is present. A missing key only matters when that provider is called. */
export interface ProviderClients {
	anthropic?: Anthropic;
	azure?: OpenAI;
	meta?: OpenAI;
	inception?: OpenAI;
	deepseek?: OpenAI;
	geminiKey?: string;
}

/** Clients for every provider that has a key in `env` (normally `process.env`, loaded from `.env`). */
export function createClients(env: Record<string, string | undefined>): ProviderClients {
	const openAiCompatible = (apiKey: string | undefined, baseURL: string | undefined) =>
		apiKey && baseURL ? new OpenAI({ apiKey, baseURL, maxRetries: SDK_RETRIES, timeout: CALL_TIMEOUT_MS }) : undefined;
	return {
		anthropic: env.ANTHROPIC_API_KEY
			? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: SDK_RETRIES, timeout: CALL_TIMEOUT_MS })
			: undefined,
		azure: openAiCompatible(env.AZURE_API_KEY, env.AZURE_BASE_URL),
		meta: openAiCompatible(env.META_MODEL_API_KEY, "https://api.meta.ai/v1"),
		inception: openAiCompatible(env.INCEPTION_API_KEY, "https://api.inceptionlabs.ai/v1"),
		deepseek: openAiCompatible(env.DEEPSEEK_API_KEY, "https://api.deepseek.com"),
		geminiKey: env.GEMINI_API_KEY || undefined,
	};
}

/** The client for a provider, or an error naming the missing key. */
function required<T>(client: T | undefined, keyName: string): T {
	if (!client) throw new Error(`${keyName} is not set; add it to the evaluator's .env`);
	return client;
}

/** Calls one model once (the SDKs and the Gemini path retry transient failures inside this call). */
export async function callModel(call: ModelCall, clients: ProviderClients): Promise<CallResult> {
	const entry = resolveModel(call.modelKey, call.reasoning);
	const started = Date.now();
	switch (entry.provider) {
		case "anthropic": {
			const client = required(clients.anthropic, "ANTHROPIC_API_KEY");
			const message = await client.messages.stream(anthropicParams(entry, call)).finalMessage();
			return fromAnthropic(message, Date.now() - started);
		}
		case "azure": {
			const client = required(clients.azure, "AZURE_API_KEY and AZURE_BASE_URL");
			if (entry.azureApi === "chat") {
				return fromChat(await client.chat.completions.create(chatParams(entry, call)), Date.now() - started);
			}
			return fromResponses(await client.responses.create(responsesParams(entry, call)), Date.now() - started);
		}
		case "meta":
			return chat(required(clients.meta, "META_MODEL_API_KEY"), entry, call, started);
		case "inception":
			return chat(required(clients.inception, "INCEPTION_API_KEY"), entry, call, started);
		case "deepseek":
			return chat(required(clients.deepseek, "DEEPSEEK_API_KEY"), entry, call, started);
		case "google":
			return callGemini(entry, call, required(clients.geminiKey, "GEMINI_API_KEY"), started);
	}
}

/** One Chat Completions call on an OpenAI-compatible provider. */
async function chat(client: OpenAI, entry: ModelEntry, call: ModelCall, started: number): Promise<CallResult> {
	return fromChat(await client.chat.completions.create(chatParams(entry, call)), Date.now() - started);
}

/**
 * One generateContent call, retried on 429 and 5xx.
 *
 * The wait honours Google's own `retryDelay` when the error carries one, otherwise it backs off
 * exponentially from two seconds. The key travels in a header so it never appears in a logged URL.
 */
async function callGemini(entry: ModelEntry, call: ModelCall, apiKey: string, started: number): Promise<CallResult> {
	const url = `https://generativelanguage.googleapis.com/v1beta/models/${entry.apiModel}:generateContent`;
	for (let attempt = 0; ; attempt++) {
		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
			body: JSON.stringify(geminiBody(call)),
			signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
		});
		if (response.ok) {
			return fromGemini((await response.json()) as GeminiResponse, Date.now() - started);
		}
		const detail = (await response.text()).slice(0, 600);
		const retryable = response.status === 429 || response.status >= 500;
		if (!retryable || attempt >= GEMINI_RETRIES) {
			throw new Error(`Gemini ${response.status}: ${detail}`);
		}
		await new Promise((resolve) => setTimeout(resolve, geminiRetryDelayMs(detail, attempt)));
	}
}

/** Google's suggested wait from an error body (`"retryDelay": "36s"`), else exponential backoff. */
export function geminiRetryDelayMs(errorBody: string, attempt: number): number {
	const match = errorBody.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
	if (match) return Math.ceil(Number(match[1]) * 1000) + 500;
	return Math.min(60_000, 2000 * 2 ** attempt);
}

/** The list-price cost of a finished call, in US dollars. */
export function callCostUsd(call: ModelCall, result: CallResult, options: { batch?: boolean } = {}): number {
	return costUsd(resolveModel(call.modelKey, call.reasoning), result.usage, options);
}
