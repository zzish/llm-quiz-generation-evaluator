/** An external quiz becomes a generation record judged against the suite's own words, once. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readJsonl } from "./files.js";
import { generationFromExternal, importGenerations } from "./import.js";
import type { ExternalGeneration, GenerationRecord, Suite } from "./types.js";

const suite: Suite = {
	id: "suite-test",
	requests: [
		{ id: "plain", learning_objective: "Fractions", request: "10 question quiz" },
		{ id: "sourced", learning_objective: "The water cycle", request: "10 question quiz based only on the source text", source_text: "Oceans store 96% of all water." },
	],
};

const quiz = {
	quiz_title: "Water",
	learning_objective: "The water cycle",
	questions: [{ id: 1, type: "multiple_choice", question: "Where is most water stored?", choices: ["Oceans", "Glaciers", "Rivers", "Lakes"], answer_index: 0, explanation: "Oceans store 96%." }],
};

const item = (overrides: Partial<ExternalGeneration> = {}): ExternalGeneration => ({
	request_id: "sourced",
	config_id: "notebook-today",
	run: 1,
	model: "Notebook pipeline",
	reasoning: "pipeline",
	started_at: "2026-10-20T00:00:00.000Z",
	latency_ms: 1234,
	usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: null, cachedInputTokens: 0 },
	cost_usd: 0.001,
	quiz,
	error: null,
	detail: { anything: true },
	...overrides,
});

test("the record carries the suite's request and passage, and the quiz passes the same checks", () => {
	const record = generationFromExternal(item(), suite);
	assert.equal(record.key, "sourced|notebook-today|1");
	assert.equal(record.request, "10 question quiz based only on the source text");
	assert.equal(record.source_text, "Oceans store 96% of all water.");
	assert.deepEqual(record.quiz_json, quiz);
	assert.equal(record.consistency_pass, true);
	assert.equal(record.error, null);
	assert.equal("detail" in record, false);
});

test("a pipeline that wrote nothing is an error, and a quiz that breaks the schema is recorded as such", () => {
	assert.equal(generationFromExternal(item({ quiz: null }), suite).error, "the pipeline produced no quiz");
	const broken = generationFromExternal(item({ quiz: { ...quiz, questions: [{ ...quiz.questions[0], answer_index: 7 }] } }), suite);
	assert.equal(broken.consistency_pass, false);
	assert.ok(broken.schema_errors.some((error) => error.includes("answer_index")));
	assert.throws(() => generationFromExternal(item({ request_id: "missing" }), suite), /not in suite/);
});

test("importing twice records each key once; a failed one is replaced only when asked", () => {
	const dir = mkdtempSync(join(tmpdir(), "import-test-"));
	try {
		const outFile = join(dir, "generations.jsonl");
		const log = () => {};
		const first = importGenerations({ suite, items: [item(), item({ request_id: "plain", quiz: null, error: "boom" })], outFile, retryErrors: false, log });
		assert.deepEqual([first.ran, first.failed, first.skipped], [1, 1, 0]);
		const again = importGenerations({ suite, items: [item(), item({ request_id: "plain" })], outFile, retryErrors: false, log });
		assert.deepEqual([again.ran, again.skipped], [0, 2]);
		const retried = importGenerations({ suite, items: [item({ request_id: "plain" })], outFile, retryErrors: true, log });
		assert.equal(retried.ran, 1);
		const records = readJsonl<GenerationRecord>(outFile);
		assert.equal(records.length, 3);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
