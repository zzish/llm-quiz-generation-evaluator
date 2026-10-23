/**
 * Request bodies for each provider, and the readers that turn each provider's response into one shape.
 *
 * Nothing here touches the network, so every wire format can be checked by a unit test. Sampling settings
 * (`temperature` and the like) are never sent: Claude Opus 5.5 and Haiku 5.5 reject them, DeepSeek ignores
 * them while thinking, and Google advises keeping Gemini 3 and later at the default. Every model therefore
 * runs at its provider's default sampling, which is the one setting all of them share.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import type { ModelEntry } from "./registry.js";
import type { CallResult, ModelCall } from "./types.js";

type AnthropicParams = Anthropic.MessageCreateParamsNonStreaming;
type ResponsesParams = OpenAI.Responses.ResponseCreateParamsNonStreaming;
type ChatParams = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
type Effort = NonNullable<NonNullable<AnthropicParams["output_config"]>["effort"]>;

/**
 * Messages API parameters for a Claude model.
 *
 * Thinking stays adaptive (the only mode Opus 5.5 accepts) and the reasoning level becomes
 * `output_config.effort`. There is no JSON switch here on purpose: the judge prompt already demands one
 * JSON object, and a schema would bind Claude more tightly than the other judges are bound.
 */
export function anthropicParams(entry: ModelEntry, call: ModelCall): AnthropicParams {
	return {
		model: entry.apiModel,
		max_tokens: call.maxOutputTokens,
		messages: [{ role: "user", content: call.prompt }],
		thinking: { type: "adaptive" },
		output_config: { effort: call.reasoning as Effort },
	};
}

/**
 * Responses API parameters for an Azure GPT deployment.
 *
 * `store: false` keeps Azure from retaining the prompt and answer for its 30-day lookup window.
 */
export function responsesParams(entry: ModelEntry, call: ModelCall): ResponsesParams {
	return {
		model: entry.apiModel,
		input: call.prompt,
		reasoning: { effort: call.reasoning as NonNullable<ResponsesParams["reasoning"]>["effort"] },
		max_output_tokens: call.maxOutputTokens,
		store: false,
		...(call.json ? { text: { format: { type: "json_object" } } } : {}),
	};
}

/**
 * Chat Completions parameters for the OpenAI-compatible providers (Azure DeepSeek, Meta, Inception, DeepSeek).
 *
 * Each spells reasoning its own way, so the extra fields are added per provider. Fields the OpenAI types
 * do not know (`thinking`, Mercury's `instant`) are sent as they are; the SDK passes the body through.
 */
export function chatParams(entry: ModelEntry, call: ModelCall): ChatParams {
	const body: Record<string, unknown> = {
		model: entry.apiModel,
		messages: [{ role: "user", content: call.prompt }],
		max_tokens: call.maxOutputTokens,
	};
	if (entry.provider === "deepseek") {
		body.thinking = { type: call.reasoning === "off" ? "disabled" : "enabled" };
		if (call.reasoning !== "off") body.reasoning_effort = call.reasoning;
	} else {
		body.reasoning_effort = call.reasoning;
	}
	if (call.json) {
		body.response_format = { type: "json_object" };
	}
	return body as unknown as ChatParams;
}

/** generateContent body for a Gemini model; the reasoning level becomes `thinkingConfig.thinkingLevel`. */
export function geminiBody(call: ModelCall): Record<string, unknown> {
	return {
		contents: [{ role: "user", parts: [{ text: call.prompt }] }],
		generationConfig: {
			maxOutputTokens: call.maxOutputTokens,
			thinkingConfig: { thinkingLevel: call.reasoning },
			...(call.json ? { responseMimeType: "application/json" } : {}),
		},
	};
}

/** A Claude message in the shared shape. Input counts every token, cached or not. */
export function fromAnthropic(message: Anthropic.Message, latencyMs: number): CallResult {
	const usage = message.usage;
	const cacheRead = usage.cache_read_input_tokens ?? 0;
	const cacheWrite = usage.cache_creation_input_tokens ?? 0;
	return {
		text: message.content.map((block) => (block.type === "text" ? block.text : "")).join(""),
		usage: {
			inputTokens: usage.input_tokens + cacheRead + cacheWrite,
			outputTokens: usage.output_tokens,
			reasoningTokens: null,
			cachedInputTokens: cacheRead,
		},
		finish: {
			raw: message.stop_reason ?? null,
			truncated: message.stop_reason === "max_tokens",
			refused: message.stop_reason === "refusal",
		},
		latencyMs,
		responseId: message.id ?? null,
	};
}

/** A Responses API result in the shared shape. */
export function fromResponses(response: OpenAI.Responses.Response, latencyMs: number): CallResult {
	const usage = response.usage;
	const reason = response.incomplete_details?.reason ?? null;
	return {
		text: response.output_text ?? "",
		usage: {
			inputTokens: usage?.input_tokens ?? 0,
			outputTokens: usage?.output_tokens ?? 0,
			reasoningTokens: usage?.output_tokens_details?.reasoning_tokens ?? null,
			cachedInputTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
		},
		finish: {
			raw: reason ? `${response.status}:${reason}` : (response.status ?? null),
			truncated: reason === "max_output_tokens",
			refused: reason === "content_filter",
		},
		latencyMs,
		responseId: response.id ?? null,
	};
}

/** A Chat Completions result in the shared shape. */
export function fromChat(completion: OpenAI.Chat.Completions.ChatCompletion, latencyMs: number): CallResult {
	const choice = completion.choices[0];
	const usage = completion.usage;
	const finishReason = choice?.finish_reason ?? null;
	return {
		text: choice?.message?.content ?? "",
		usage: {
			inputTokens: usage?.prompt_tokens ?? 0,
			outputTokens: usage?.completion_tokens ?? 0,
			reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? null,
			cachedInputTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
		},
		finish: {
			raw: finishReason,
			truncated: finishReason === "length",
			refused: finishReason === "content_filter",
		},
		latencyMs,
		responseId: completion.id ?? null,
	};
}

/** The parts of a generateContent response this reader uses. */
export interface GeminiResponse {
	responseId?: string;
	candidates?: Array<{
		finishReason?: string;
		content?: { parts?: Array<{ text?: string; thought?: boolean }> };
	}>;
	usageMetadata?: {
		promptTokenCount?: number;
		candidatesTokenCount?: number;
		thoughtsTokenCount?: number;
		cachedContentTokenCount?: number;
	};
	promptFeedback?: { blockReason?: string };
}

/** Finish reasons Google uses when it withholds an answer. */
const GEMINI_REFUSALS = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII"]);

/**
 * A Gemini response in the shared shape.
 *
 * Thought parts are left out of the text, and thinking tokens are added to the output count because
 * Google bills them at the output rate.
 */
export function fromGemini(response: GeminiResponse, latencyMs: number): CallResult {
	const candidate = response.candidates?.[0];
	const usage = response.usageMetadata ?? {};
	const thoughts = usage.thoughtsTokenCount ?? 0;
	const finishReason = candidate?.finishReason ?? response.promptFeedback?.blockReason ?? null;
	return {
		text: (candidate?.content?.parts ?? [])
			.filter((part) => !part.thought)
			.map((part) => part.text ?? "")
			.join(""),
		usage: {
			inputTokens: usage.promptTokenCount ?? 0,
			outputTokens: (usage.candidatesTokenCount ?? 0) + thoughts,
			reasoningTokens: thoughts,
			cachedInputTokens: usage.cachedContentTokenCount ?? 0,
		},
		finish: {
			raw: finishReason,
			truncated: finishReason === "MAX_TOKENS",
			refused: finishReason !== null && (GEMINI_REFUSALS.has(finishReason) || Boolean(response.promptFeedback?.blockReason)),
		},
		latencyMs,
		responseId: response.responseId ?? null,
	};
}
