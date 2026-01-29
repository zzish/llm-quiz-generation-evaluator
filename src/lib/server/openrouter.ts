const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export interface ChatMessage {
	role: "user" | "assistant" | "system";
	content: string;
}

export interface ChatResult {
	rawText: string;
	serviceTimeMs: number;
	wallTimeMs: number;
	retryCount: number;
	backoffMsTotal: number;
	throttleEvents: number;
	usage?: { prompt_tokens: number; completion_tokens: number };
	cost?: number;
}

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

/**
 * Call OpenRouter chat completions. On 429, retry with exponential backoff.
 * Returns raw text, service time (TTFB), wall time, retry/backoff/throttle counts, usage and cost if present.
 * apiKey is supplied by the client via request header (not from env).
 */
export async function chat(options: {
	apiKey: string;
	modelId: string;
	messages: ChatMessage[];
	temperature?: number;
	maxTokens?: number;
	/** Optional. { type: "json_object" } asks the model to return valid JSON (OpenRouter normalizes for GPT, Claude, Gemini). */
	response_format?: { type: "json_object" };
}): Promise<ChatResult> {
	const apiKey = options.apiKey;
	if (!apiKey?.trim()) {
		throw new Error("OpenRouter API key is required");
	}
	const url = `${OPENROUTER_BASE}/chat/completions`;
	const body: Record<string, unknown> = {
		model: options.modelId,
		messages: options.messages,
		temperature: options.temperature ?? 0.7,
		max_tokens: options.maxTokens ?? 4096,
	};
	if (options.response_format) {
		body.response_format = options.response_format;
	}
	let lastError: Error | null = null;
	let throttleEvents = 0;
	let retryCount = 0;
	let backoffMsTotal = 0;
	const startWall = Date.now();
	let firstByteAt: number | null = null;
	let rawText = "";
	let usage: { prompt_tokens: number; completion_tokens: number } | undefined;
	let cost: number | undefined;

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		try {
			const res = await fetch(url, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			});

			if (res.status === 429) {
				throttleEvents++;
				const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
				backoffMsTotal += backoff;
				retryCount++;
				if (attempt < MAX_RETRIES) {
					await new Promise((r) => setTimeout(r, backoff));
					continue;
				}
			}

			if (!res.ok) {
				const errText = await res.text();
				throw new Error(`OpenRouter ${res.status}: ${errText.slice(0, 200)}`);
			}

			const data = (await res.json()) as {
				choices?: Array<{ message?: { content?: string } }>;
				usage?: {
					prompt_tokens?: number;
					completion_tokens?: number;
					total_tokens?: number;
					cost?: number;
				};
			};
			const content = data.choices?.[0]?.message?.content ?? "";
			rawText = typeof content === "string" ? content : JSON.stringify(content);
			// For non-streaming, we get the full response at once; TTFB ≈ wall time
			firstByteAt = firstByteAt ?? Date.now();
			if (data.usage) {
				usage = {
					prompt_tokens: data.usage.prompt_tokens ?? 0,
					completion_tokens: data.usage.completion_tokens ?? 0,
				};
				if (typeof (data.usage as { cost?: number }).cost === "number") {
					cost = (data.usage as { cost: number }).cost;
				}
			}
			const wallTimeMs = Date.now() - startWall;
			const serviceTimeMs = firstByteAt ? firstByteAt - startWall : wallTimeMs;
			return {
				rawText,
				serviceTimeMs,
				wallTimeMs,
				retryCount,
				backoffMsTotal,
				throttleEvents,
				usage,
				cost,
			};
		} catch (e) {
			lastError = e instanceof Error ? e : new Error(String(e));
			if (attempt < MAX_RETRIES) {
				const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
				backoffMsTotal += backoff;
				await new Promise((r) => setTimeout(r, backoff));
			}
		}
	}
	throw lastError ?? new Error("OpenRouter request failed");
}
