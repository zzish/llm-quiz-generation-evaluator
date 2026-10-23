/** Wire formats and response readers for every provider the batch runner calls directly. */
import assert from "node:assert/strict";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import { geminiRetryDelayMs } from "./call.js";
import { costUsd, MODEL_REGISTRY, resolveModel } from "./registry.js";
import { anthropicParams, chatParams, fromAnthropic, fromChat, fromGemini, fromResponses, geminiBody, responsesParams } from "./requests.js";
import type { ModelCall } from "./types.js";

const call = (modelKey: string, reasoning: string, json = false): ModelCall => ({
	modelKey,
	reasoning,
	prompt: "Return JSON.",
	maxOutputTokens: 1000,
	json,
});

test("every registry entry names at least one reasoning level and positive prices", () => {
	for (const entry of MODEL_REGISTRY.values()) {
		assert.ok(entry.levels.length > 0, entry.key);
		assert.ok(entry.pricing.input > 0 && entry.pricing.output > 0, entry.key);
	}
});

test("resolveModel refuses an unknown model and a level the model does not have", () => {
	assert.throws(() => resolveModel("azure:gpt-9", "max"), /Unknown model/);
	assert.throws(() => resolveModel("azure:gpt-6-astra", "none"), /no reasoning level "none"/);
	assert.equal(resolveModel("azure:gpt-6-luna", "none").apiModel, "gpt-6-luna");
});

test("costUsd prices cached input separately and halves a batch", () => {
	const opus = resolveModel("anthropic:claude-opus-5-5", "max");
	const usage = { inputTokens: 1000, outputTokens: 500, reasoningTokens: null, cachedInputTokens: 200 };
	// 800 × $4 + 200 × $0.20 + 500 × $20, per million.
	assert.equal(costUsd(opus, usage), (800 * 4 + 200 * 0.2 + 500 * 20) / 1e6);
	assert.equal(costUsd(opus, usage, { batch: true }), (800 * 4 + 200 * 0.2 + 500 * 20) / 2e6);
});

test("Claude gets adaptive thinking, the effort, and no sampling settings", () => {
	const params = anthropicParams(resolveModel("anthropic:claude-opus-5-5", "max"), call("anthropic:claude-opus-5-5", "max", true));
	assert.equal(params.model, "claude-opus-5-5");
	assert.deepEqual(params.thinking, { type: "adaptive" });
	assert.deepEqual(params.output_config, { effort: "max" });
	assert.equal("temperature" in params, false);
});

test("Azure GPT goes through the Responses API with the effort, no storage, and JSON only on request", () => {
	const astra = resolveModel("azure:gpt-6-astra", "max");
	const judge = responsesParams(astra, call("azure:gpt-6-astra", "max", true));
	assert.deepEqual(judge.reasoning, { effort: "max" });
	assert.equal(judge.store, false);
	assert.deepEqual(judge.text, { format: { type: "json_object" } });
	assert.equal("text" in responsesParams(astra, call("azure:gpt-6-astra", "max")), false);
});

test("each chat provider spells reasoning its own way", () => {
	const deepseekOff = chatParams(resolveModel("deepseek:deepseek-flash", "off"), call("deepseek:deepseek-flash", "off")) as unknown as Record<string, unknown>;
	assert.deepEqual(deepseekOff.thinking, { type: "disabled" });
	assert.equal("reasoning_effort" in deepseekOff, false);

	const deepseekHigh = chatParams(resolveModel("deepseek:deepseek-flash", "high"), call("deepseek:deepseek-flash", "high")) as unknown as Record<string, unknown>;
	assert.deepEqual(deepseekHigh.thinking, { type: "enabled" });
	assert.equal(deepseekHigh.reasoning_effort, "high");

	const muse = chatParams(resolveModel("meta:muse-wonder-1.0", "max"), call("meta:muse-wonder-1.0", "max", true)) as unknown as Record<string, unknown>;
	assert.equal(muse.reasoning_effort, "max");
	assert.deepEqual(muse.response_format, { type: "json_object" });

	const mercury = chatParams(resolveModel("inception:mercury-3", "instant"), call("inception:mercury-3", "instant")) as unknown as Record<string, unknown>;
	assert.equal(mercury.reasoning_effort, "instant");
	assert.equal("response_format" in mercury, false);
});

test("Gemini gets the thinking level and asks for JSON by MIME type", () => {
	const body = geminiBody(call("google:gemini-4-argon", "high", true)) as { generationConfig: Record<string, unknown> };
	assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: "high" });
	assert.equal(body.generationConfig.responseMimeType, "application/json");
});

test("a Claude message counts cache reads as input and flags max_tokens and refusal", () => {
	const message = {
		id: "msg_1",
		content: [{ type: "text", text: '{"a":1}' }],
		stop_reason: "max_tokens",
		usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 0 },
	} as unknown as Anthropic.Message;
	const result = fromAnthropic(message, 42);
	assert.equal(result.text, '{"a":1}');
	assert.deepEqual(result.usage, { inputTokens: 15, outputTokens: 20, reasoningTokens: null, cachedInputTokens: 5 });
	assert.equal(result.finish.truncated, true);
	assert.equal(fromAnthropic({ ...message, stop_reason: "refusal" } as Anthropic.Message, 1).finish.refused, true);
});

test("a Responses result that ran out of tokens is marked truncated", () => {
	const response = {
		id: "resp_1",
		status: "incomplete",
		incomplete_details: { reason: "max_output_tokens" },
		output_text: "",
		usage: { input_tokens: 100, output_tokens: 1000, output_tokens_details: { reasoning_tokens: 990 }, input_tokens_details: { cached_tokens: 0 } },
	} as unknown as OpenAI.Responses.Response;
	const result = fromResponses(response, 5);
	assert.equal(result.finish.truncated, true);
	assert.equal(result.usage.reasoningTokens, 990);
	assert.equal(result.finish.raw, "incomplete:max_output_tokens");
});

test("a chat result cut at the limit is marked truncated", () => {
	const completion = {
		id: "c1",
		choices: [{ finish_reason: "length", message: { content: "{" } }],
		usage: { prompt_tokens: 3, completion_tokens: 7, completion_tokens_details: { reasoning_tokens: 4 } },
	} as unknown as OpenAI.Chat.Completions.ChatCompletion;
	const result = fromChat(completion, 1);
	assert.equal(result.finish.truncated, true);
	assert.equal(result.usage.reasoningTokens, 4);
});

test("Gemini text leaves thought parts out and bills thoughts as output", () => {
	const result = fromGemini(
		{
			candidates: [{ finishReason: "STOP", content: { parts: [{ text: "thinking…", thought: true }, { text: '{"ok":true}' }] } }],
			usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 10, thoughtsTokenCount: 50 },
		},
		9,
	);
	assert.equal(result.text, '{"ok":true}');
	assert.equal(result.usage.outputTokens, 60);
	assert.equal(result.usage.reasoningTokens, 50);
	assert.equal(result.finish.truncated, false);
	assert.equal(fromGemini({ candidates: [{ finishReason: "MAX_TOKENS" }] }, 1).finish.truncated, true);
	assert.equal(fromGemini({ candidates: [{ finishReason: "SAFETY" }] }, 1).finish.refused, true);
});

test("Gemini retries wait as long as Google asks, otherwise back off", () => {
	assert.equal(geminiRetryDelayMs('{"retryDelay": "36s"}', 0), 36_500);
	assert.equal(geminiRetryDelayMs("busy", 0), 2000);
	assert.equal(geminiRetryDelayMs("busy", 10), 60_000);
});
