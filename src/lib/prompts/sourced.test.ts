/** Sourced ("RAG") prompts: the passage and the fidelity rule are added, and nothing else changes. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildJudgePrompt, buildSourcedJudgePrompt } from "./judge.js";
import { buildSourcedTestPrompt, buildTestPrompt } from "./test.js";

const OBJECTIVE = "Earth science: the water cycle";
const REQUEST = "10 question quiz based on the passage";
const SOURCE = "Oceans store 96% of all water on Earth.";

test("the sourced generation prompt is the plain prompt with the passage block before the JSON instructions", () => {
	const plain = buildTestPrompt(OBJECTIVE, REQUEST);
	const sourced = buildSourcedTestPrompt(OBJECTIVE, REQUEST, `  ${SOURCE}\n`);
	assert.ok(sourced.includes(`<SOURCE_TEXT>\n${SOURCE}\n</SOURCE_TEXT>`));
	assert.ok(sourced.indexOf("<SOURCE_TEXT>") < sourced.indexOf("Return ONLY valid JSON"));
	const added = sourced.slice(sourced.indexOf("\n\nBase every question"), sourced.indexOf("</SOURCE_TEXT>") + "</SOURCE_TEXT>".length);
	assert.equal(sourced.replace(added, ""), plain);
	assert.equal(plain.includes("SOURCE_TEXT"), false);
});

test("the sourced judge prompt adds the fidelity rule and the passage, and keeps the rest of the prompt", () => {
	const quiz = '{"quiz_title":"t","questions":[]}';
	const plain = buildJudgePrompt(OBJECTIVE, REQUEST, quiz);
	const sourced = buildSourcedJudgePrompt(OBJECTIVE, REQUEST, quiz, SOURCE);
	assert.ok(sourced.includes("### SOURCE FIDELITY"));
	assert.ok(sourced.includes('"not_in_source"'));
	assert.ok(sourced.indexOf("### SOURCE FIDELITY") < sourced.indexOf("<JUDGE_RESPONSE_SCHEMA>\n"));
	assert.ok(sourced.indexOf(`<SOURCE_TEXT>\n${SOURCE}\n</SOURCE_TEXT>`) < sourced.indexOf("\n<QUIZ>\n"));
	const withoutRule = sourced.slice(0, sourced.indexOf("### SOURCE FIDELITY")) + sourced.slice(sourced.indexOf("<JUDGE_RESPONSE_SCHEMA>\n"));
	const withoutSource = withoutRule.replace(`<SOURCE_TEXT>\n${SOURCE}\n</SOURCE_TEXT>\n\n`, "");
	assert.equal(withoutSource, plain);
});
