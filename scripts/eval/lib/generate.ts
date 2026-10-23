/**
 * The generate step: every candidate configuration writes a quiz for every request in the suite.
 *
 * It uses the app's own generation prompt, quiz parser and schema check, so a quiz written here is
 * judged exactly as one written in the web UI would be.
 */
import { buildSourcedTestPrompt, buildTestPrompt } from "#lib/prompts/test.js";
import { callCostUsd, callModel } from "#lib/server/providers/call.js";
import type { ProviderClients } from "#lib/server/providers/call.js";
import { resolveModel } from "#lib/server/providers/registry.js";
import type { ModelCall } from "#lib/server/providers/types.js";
import { parseQuiz, validateQuizSchema } from "#lib/validation/quiz.js";
import type { Budget } from "./budget.js";
import { appendJsonl, latestByKey, readJsonl } from "./files.js";
import type { Limiter } from "./limiter.js";
import type { CandidateConfig, GenerationRecord, RunConfig, Suite, SuiteRequest } from "./types.js";

/** A candidate writes at most this many tokens unless the configuration says otherwise. */
export const DEFAULT_CANDIDATE_MAX_OUTPUT_TOKENS = 32_000;

export interface GenerateOptions {
	suite: Suite;
	config: RunConfig;
	outFile: string;
	runs: number;
	/** Candidate ids to run; all of them when absent. */
	only: Set<string> | null;
	retryErrors: boolean;
	clients: ProviderClients;
	limiter: Limiter;
	budget: Budget;
	log: (line: string) => void;
}

/** Counts for the end-of-step report. */
export interface StepCounts {
	ran: number;
	skipped: number;
	failed: number;
	notStarted: number;
}

/** Writes every missing quiz, appending one record per call as it finishes. */
export async function generate(options: GenerateOptions): Promise<StepCounts> {
	const existing = latestByKey(readJsonl<GenerationRecord>(options.outFile));
	const counts: StepCounts = { ran: 0, skipped: 0, failed: 0, notStarted: 0 };
	const jobs: Promise<void>[] = [];
	for (const candidate of options.config.candidates) {
		if (options.only && !options.only.has(candidate.id)) continue;
		const entry = resolveModel(candidate.model, candidate.reasoning);
		for (const request of options.suite.requests) {
			for (let run = 1; run <= options.runs; run++) {
				const key = `${request.id}|${candidate.id}|${run}`;
				const previous = existing.get(key);
				if (previous && (!previous.error || !options.retryErrors)) {
					counts.skipped++;
					continue;
				}
				jobs.push(
					options.limiter.run(entry.provider, async () => {
						if (options.budget.exhausted()) {
							counts.notStarted++;
							return;
						}
						const record = await writeOne(key, run, request, candidate, options);
						options.budget.add(record.cost_usd);
						appendJsonl(options.outFile, record);
						if (record.error) counts.failed++;
						else counts.ran++;
						options.log(describe(record));
					}),
				);
			}
		}
	}
	await Promise.all(jobs);
	return counts;
}

/** One candidate call, parsed and schema-checked, as a record. Errors become part of the record. */
async function writeOne(
	key: string,
	run: number,
	request: SuiteRequest,
	candidate: CandidateConfig,
	options: GenerateOptions,
): Promise<GenerationRecord> {
	const call: ModelCall = {
		modelKey: candidate.model,
		reasoning: candidate.reasoning,
		prompt: request.source_text
			? buildSourcedTestPrompt(request.learning_objective, request.request, request.source_text)
			: buildTestPrompt(request.learning_objective, request.request),
		maxOutputTokens: options.config.limits?.candidateMaxOutputTokens ?? DEFAULT_CANDIDATE_MAX_OUTPUT_TOKENS,
	};
	const base = {
		kind: "generation" as const,
		key,
		request_id: request.id,
		config_id: candidate.id,
		run,
		model: candidate.model,
		reasoning: candidate.reasoning,
		learning_objective: request.learning_objective,
		request: request.request,
		...(request.source_text ? { source_text: request.source_text } : {}),
		started_at: new Date().toISOString(),
	};
	try {
		const result = await callModel(call, options.clients);
		const parsed = parseQuiz(result.text);
		const validated = parsed.data ? validateQuizSchema(parsed.data) : null;
		return {
			...base,
			latency_ms: result.latencyMs,
			usage: result.usage,
			cost_usd: callCostUsd(call, result),
			finish: result.finish,
			raw_text: result.text,
			quiz_json: parsed.data ?? null,
			parse_error: parsed.parseError ?? null,
			schema_errors: validated?.errors ?? [],
			consistency_pass: validated?.valid ?? false,
			error: null,
		};
	} catch (error) {
		return {
			...base,
			latency_ms: null,
			usage: null,
			cost_usd: null,
			finish: null,
			raw_text: "",
			quiz_json: null,
			parse_error: null,
			schema_errors: [],
			consistency_pass: false,
			error: error instanceof Error ? error.message.slice(0, 500) : String(error),
		};
	}
}

/** One progress line for a finished call. */
function describe(record: GenerationRecord): string {
	if (record.error) return `gen  ${record.key}  ✗ ${record.error}`;
	const flags = [
		record.consistency_pass ? "schema ok" : `schema FAIL${record.parse_error ? " (unparseable)" : ""}`,
		record.finish?.truncated ? "TRUNCATED" : "",
		record.finish?.refused ? "REFUSED" : "",
	].filter(Boolean);
	return `gen  ${record.key}  ✓ ${((record.latency_ms ?? 0) / 1000).toFixed(1)}s $${(record.cost_usd ?? 0).toFixed(4)}  ${flags.join(", ")}`;
}
