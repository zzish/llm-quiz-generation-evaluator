/**
 * The import step: quizzes written by a pipeline outside the evaluator become generation records, so the
 * judges and the summary treat them exactly like the candidates' quizzes.
 *
 * The learning objective, the request and any source passage are taken from the SUITE rather than from the
 * driver's file, so every quiz written for a request is judged against the same words. The quiz goes through
 * the same parser and schema check as a candidate's.
 */
import { parseQuiz, validateQuizSchema } from "#lib/validation/quiz.js";
import { appendJsonl, latestByKey, readJsonl } from "./files.js";
import type { StepCounts } from "./generate.js";
import type { ExternalGeneration, GenerationRecord, Suite } from "./types.js";

export interface ImportOptions {
	suite: Suite;
	items: ExternalGeneration[];
	outFile: string;
	retryErrors: boolean;
	log: (line: string) => void;
}

/** The generation record for one external quiz. Throws when its request is not in the suite. */
export function generationFromExternal(item: ExternalGeneration, suite: Suite): GenerationRecord {
	const request = suite.requests.find((candidate) => candidate.id === item.request_id);
	if (!request) throw new Error(`Request "${item.request_id}" is not in suite ${suite.id}`);
	const raw = item.quiz == null ? "" : typeof item.quiz === "string" ? item.quiz : JSON.stringify(item.quiz);
	const parsed = raw ? parseQuiz(raw) : null;
	const validated = parsed?.data ? validateQuizSchema(parsed.data) : null;
	return {
		kind: "generation",
		key: `${item.request_id}|${item.config_id}|${item.run}`,
		request_id: item.request_id,
		config_id: item.config_id,
		run: item.run,
		model: item.model,
		reasoning: item.reasoning,
		learning_objective: request.learning_objective,
		request: request.request,
		...(request.source_text ? { source_text: request.source_text } : {}),
		started_at: item.started_at,
		latency_ms: item.latency_ms,
		usage: item.usage,
		cost_usd: item.cost_usd,
		finish: null,
		raw_text: raw,
		quiz_json: parsed?.data ?? null,
		parse_error: parsed?.parseError ?? null,
		schema_errors: validated?.errors ?? [],
		consistency_pass: validated?.valid ?? false,
		error: item.error ?? (raw ? null : "the pipeline produced no quiz"),
	};
}

/**
 * Appends a record for every external quiz not already recorded.
 *
 * The driver's file may hold several lines for one key when a request was run again; the last one wins, as
 * it does everywhere else in the runner.
 */
export function importGenerations(options: ImportOptions): StepCounts {
	const existing = latestByKey(readJsonl<GenerationRecord>(options.outFile));
	const counts: StepCounts = { ran: 0, skipped: 0, failed: 0, notStarted: 0 };
	const records = latestByKey(options.items.map((item) => generationFromExternal(item, options.suite)));
	for (const record of records.values()) {
		const previous = existing.get(record.key);
		if (previous && (!previous.error || !options.retryErrors)) {
			counts.skipped++;
			continue;
		}
		appendJsonl(options.outFile, record);
		if (record.error) counts.failed++;
		else counts.ran++;
		const outcome = record.error ? `✗ ${record.error}` : `${record.quiz_json?.questions?.length ?? 0} questions, schema ${record.consistency_pass ? "ok" : "FAIL"}`;
		options.log(`import ${record.key}  ${outcome}`);
	}
	return counts;
}
