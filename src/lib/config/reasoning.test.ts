/** The effort selector offers exactly what OpenRouter's model list says each judge accepts. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { effortChoices, isReasoningEffort, REASONING_EFFORTS } from "./reasoning.js";

// `reasoning` objects as GET https://openrouter.ai/api/v1/models returned them on 2026-10-20.
const ARGON = { mandatory: true, supported_efforts: ["high", "medium", "low"], default_effort: "medium" };
const OPUS = { mandatory: true, supported_efforts: ["max", "xhigh", "high", "medium", "low"], default_effort: "high" };
const LUNA = {
	mandatory: false,
	default_enabled: true,
	supported_efforts: ["max", "xhigh", "high", "medium", "low", "none"],
	default_effort: "medium",
};

test("a judge is offered only the efforts its model lists, highest first", () => {
	assert.deepEqual(effortChoices(ARGON), ["high", "medium", "low"]);
	assert.deepEqual(effortChoices(OPUS), ["max", "xhigh", "high", "medium", "low"]);
	assert.deepEqual(effortChoices(LUNA), ["max", "xhigh", "high", "medium", "low", "none"]);
});

test("a model that must reason is never offered none, even if it lists it", () => {
	assert.deepEqual(effortChoices({ mandatory: true, supported_efforts: ["high", "none"] }), ["high"]);
});

test("a null list accepts every effort; a missing list or missing reasoning offers none", () => {
	assert.deepEqual(effortChoices({ supported_efforts: null }), [...REASONING_EFFORTS]);
	assert.deepEqual(effortChoices({ default_effort: "medium" }), []);
	assert.deepEqual(effortChoices(undefined), []);
});

test("an effort OpenRouter does not define is dropped rather than sent", () => {
	assert.deepEqual(effortChoices({ supported_efforts: ["ultra", "high"] }), ["high"]);
	assert.equal(isReasoningEffort("high"), true);
	assert.equal(isReasoningEffort("ultra"), false);
	assert.equal(isReasoningEffort(3), false);
	assert.equal(isReasoningEffort(undefined), false);
});
