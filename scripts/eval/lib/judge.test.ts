/** A sourced quiz is judged with the source-fidelity prompt, wherever it came from; others are not. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { judgePromptFor, quizzesFromExternal, quizzesFromGenerations } from "./judge.js";
import type { GenerationRecord } from "./types.js";

const record = (key: string, source_text?: string): GenerationRecord => ({
	kind: "generation",
	key,
	request_id: key.split("|")[0],
	config_id: "luna-none",
	run: 1,
	model: "azure:gpt-6-luna",
	reasoning: "none",
	learning_objective: "Earth science: the water cycle",
	request: "10 question quiz based on the passage",
	...(source_text ? { source_text } : {}),
	started_at: "2026-10-20T00:00:00.000Z",
	latency_ms: 1,
	usage: null,
	cost_usd: 0,
	finish: null,
	raw_text: "{}",
	quiz_json: { quiz_title: "t", learning_objective: "l", questions: [] },
	parse_error: null,
	schema_errors: [],
	consistency_pass: true,
	error: null,
});

test("a generated quiz carries its passage to the judge prompt; a plain one does not", () => {
	const [sourced, plain] = quizzesFromGenerations([record("rag|luna-none|1", "Oceans store 96% of all water."), record("std|luna-none|1")]);
	assert.ok(judgePromptFor(sourced).includes("<SOURCE_TEXT>\nOceans store 96% of all water.\n</SOURCE_TEXT>"));
	assert.equal(judgePromptFor(plain).includes("SOURCE_TEXT"), false);
});

test("an external quiz with a passage gets the same treatment", () => {
	const [quiz] = quizzesFromExternal([{ quiz_key: "x", source: "notebook", learning_objective: "o", request: "r", quiz: "raw quiz text", source_text: "A passage." }]);
	assert.equal(quiz.source_text, "A passage.");
	assert.ok(judgePromptFor(quiz).includes("### SOURCE FIDELITY"));
});
