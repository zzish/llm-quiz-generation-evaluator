/** The chat-completions body the web app sends to OpenRouter. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { chatRequestBody } from "./openrouter.js";

const base = { modelId: "anthropic/claude-opus-5.5", messages: [{ role: "user" as const, content: "Return JSON." }] };

test("a chosen effort is sent as reasoning.effort", () => {
	const body = chatRequestBody({ ...base, reasoningEffort: "high", response_format: { type: "json_object" } });
	assert.deepEqual(body.reasoning, { effort: "high" });
	assert.deepEqual(body.response_format, { type: "json_object" });
});

test("without a chosen effort the body has no reasoning field, so the model uses its default", () => {
	const body = chatRequestBody(base);
	assert.equal("reasoning" in body, false);
	assert.equal("response_format" in body, false);
});

test("the earlier defaults still apply when the caller sets nothing", () => {
	const body = chatRequestBody(base);
	assert.equal(body.temperature, 0.7);
	assert.equal(body.max_tokens, 4096);
	assert.equal(body.model, base.modelId);
});
