/**
 * The judge step: every judge scores every quiz with the app's judge prompt and judge parser.
 *
 * Quizzes come from the generate step or from an external file (Notebook's pipeline, the legacy AI quiz
 * creator, quizzes saved elsewhere), so all of them meet the same panel. A Claude judge marked
 * `batch` goes through the Message Batches API at half price; its batches are recorded in `batches.json`
 * so a run that stops while waiting picks the same batch up again instead of paying twice.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { buildJudgePrompt, buildSourcedJudgePrompt } from "#lib/prompts/judge.js";
import { anthropicBatchResults, anthropicBatchStatus, submitAnthropicBatch } from "#lib/server/providers/anthropicBatch.js";
import { callCostUsd, callModel } from "#lib/server/providers/call.js";
import type { ProviderClients } from "#lib/server/providers/call.js";
import { resolveModel } from "#lib/server/providers/registry.js";
import type { CallResult, ModelCall } from "#lib/server/providers/types.js";
import { parseJudgeResponse } from "#lib/validation/judge.js";
import type { Budget } from "./budget.js";
import { appendJsonl, latestByKey, readJson, readJsonl, writeJson } from "./files.js";
import type { StepCounts } from "./generate.js";
import type { Limiter } from "./limiter.js";
import type { ExternalQuiz, GenerationRecord, JudgeableQuiz, JudgeConfig, JudgmentRecord, RunConfig } from "./types.js";

/** A judge writes at most this many tokens, reasoning included, unless the configuration says otherwise. */
export const DEFAULT_JUDGE_MAX_OUTPUT_TOKENS = 64_000;

/** The generated quizzes that parsed, in the form the judge prompt embeds (as the web UI does). */
export function quizzesFromGenerations(records: GenerationRecord[]): JudgeableQuiz[] {
	return [...latestByKey(records).values()]
		.filter((record) => !record.error && record.quiz_json)
		.map((record) => ({
			quiz_key: record.key,
			config_id: record.config_id,
			source: "generated",
			learning_objective: record.learning_objective,
			request: record.request,
			quiz_text: JSON.stringify(record.quiz_json),
			...(record.source_text ? { source_text: record.source_text } : {}),
		}));
}

/** The judge prompt for one quiz: with the source-fidelity rule when the quiz had to come from a passage. */
export function judgePromptFor(quiz: JudgeableQuiz): string {
	return quiz.source_text
		? buildSourcedJudgePrompt(quiz.learning_objective, quiz.request, quiz.quiz_text, quiz.source_text)
		: buildJudgePrompt(quiz.learning_objective, quiz.request, quiz.quiz_text);
}

/** External quizzes as the judges will see them: JSON as JSON, raw text as written. Keys must be unique. */
export function quizzesFromExternal(items: ExternalQuiz[]): JudgeableQuiz[] {
	const seen = new Set<string>();
	return items.map((item) => {
		if (seen.has(item.quiz_key)) throw new Error(`Duplicate quiz_key "${item.quiz_key}" in the external quizzes`);
		seen.add(item.quiz_key);
		return {
			quiz_key: item.quiz_key,
			config_id: null,
			source: item.source,
			learning_objective: item.learning_objective,
			request: item.request,
			quiz_text: typeof item.quiz === "string" ? item.quiz : JSON.stringify(item.quiz),
			...(item.source_text ? { source_text: item.source_text } : {}),
		};
	});
}

export interface JudgeOptions {
	quizzes: JudgeableQuiz[];
	config: RunConfig;
	/** Judge ids to run; all of them when absent. */
	only: Set<string> | null;
	outFile: string;
	batchStateFile: string;
	retryErrors: boolean;
	clients: ProviderClients;
	limiter: Limiter;
	budget: Budget;
	log: (line: string) => void;
	pollMs: number;
}

/** One quiz × judge pairing still to be scored. */
interface Pending {
	key: string;
	quiz: JudgeableQuiz;
	judge: JudgeConfig;
	call: ModelCall;
}

/** Scores every missing quiz × judge pairing. Direct judges run alongside the batch wait. */
export async function judge(options: JudgeOptions): Promise<StepCounts> {
	const existing = latestByKey(readJsonl<JudgmentRecord>(options.outFile));
	const counts: StepCounts = { ran: 0, skipped: 0, failed: 0, notStarted: 0 };
	const judges = options.config.judges.filter((entry) => !options.only || options.only.has(entry.id));
	const maxOutputTokens = options.config.limits?.judgeMaxOutputTokens ?? DEFAULT_JUDGE_MAX_OUTPUT_TOKENS;
	const direct: Promise<void>[] = [];
	const batched: Pending[] = [];

	for (const quiz of options.quizzes) {
		for (const panelist of judges) {
			const entry = resolveModel(panelist.model, panelist.reasoning);
			if (panelist.batch && entry.provider !== "anthropic") {
				throw new Error(`Judge "${panelist.id}" asks for batch mode, which only Claude judges have`);
			}
			const key = `${quiz.quiz_key}|${panelist.id}`;
			const previous = existing.get(key);
			if (previous && (!previous.error || !options.retryErrors)) {
				counts.skipped++;
				continue;
			}
			const pending: Pending = {
				key,
				quiz,
				judge: panelist,
				call: {
					modelKey: panelist.model,
					reasoning: panelist.reasoning,
					prompt: judgePromptFor(quiz),
					maxOutputTokens,
					json: true,
				},
			};
			if (panelist.batch) {
				batched.push(pending);
				continue;
			}
			direct.push(
				options.limiter.run(entry.provider, async () => {
					if (options.budget.exhausted()) {
						counts.notStarted++;
						return;
					}
					const record = await scoreDirect(pending, options.clients);
					finish(record, counts, options);
				}),
			);
		}
	}
	await Promise.all([...direct, runBatches(batched, counts, options)]);
	return counts;
}

/** One direct judge call as a record. Errors become part of the record. */
async function scoreDirect(pending: Pending, clients: ProviderClients): Promise<JudgmentRecord> {
	const startedAt = new Date().toISOString();
	try {
		const result = await callModel(pending.call, clients);
		return toRecord(pending, startedAt, { result, cost: callCostUsd(pending.call, result), batch: false });
	} catch (error) {
		return toRecord(pending, startedAt, { error: error instanceof Error ? error.message.slice(0, 500) : String(error), batch: false });
	}
}

/** A judgment record from a result (parsed with the app's judge parser) or from an error. */
function toRecord(
	pending: Pending,
	startedAt: string,
	outcome: { result?: CallResult; cost?: number; error?: string; batch: boolean },
): JudgmentRecord {
	const parsed = outcome.result ? parseJudgeResponse(outcome.result.text) : null;
	return {
		kind: "judgment",
		key: pending.key,
		quiz_key: pending.quiz.quiz_key,
		config_id: pending.quiz.config_id,
		source: pending.quiz.source,
		judge_id: pending.judge.id,
		model: pending.judge.model,
		reasoning: pending.judge.reasoning,
		batch: outcome.batch,
		started_at: startedAt,
		latency_ms: outcome.result && !outcome.batch ? outcome.result.latencyMs : null,
		usage: outcome.result?.usage ?? null,
		cost_usd: outcome.cost ?? null,
		finish: outcome.result?.finish ?? null,
		raw_text: outcome.result?.text ?? "",
		parsed: parsed?.data ?? null,
		parse_error: parsed?.parseError ?? null,
		error: outcome.error ?? null,
	};
}

/** Appends a record, counts it, adds its cost and prints a progress line. */
function finish(record: JudgmentRecord, counts: StepCounts, options: JudgeOptions): void {
	options.budget.add(record.cost_usd);
	appendJsonl(options.outFile, record);
	if (record.error) {
		counts.failed++;
		options.log(`judge ${record.key}  ✗ ${record.error}`);
		return;
	}
	counts.ran++;
	const score = record.parsed && "overall_score" in record.parsed ? `quality ${record.parsed.overall_score}` : `PARSE FAIL: ${record.parse_error}`;
	const timing = record.batch ? "batch" : `${((record.latency_ms ?? 0) / 1000).toFixed(1)}s`;
	const truncated = record.finish?.truncated ? "  TRUNCATED" : "";
	options.log(`judge ${record.key}  ✓ ${timing} $${(record.cost_usd ?? 0).toFixed(4)}  ${score}${truncated}`);
}

/** A submitted batch and the pairings it carries, as kept in `batches.json`. */
interface BatchState {
	id: string;
	judge_id: string;
	submitted_at: string;
	done: boolean;
	items: Array<{ custom_id: string; key: string }>;
}

/** The custom id for a pairing: a hash of its key, since keys can be longer than the 64 characters allowed. */
function customIdFor(key: string): string {
	return `j_${createHash("sha256").update(key).digest("hex").slice(0, 40)}`;
}

/**
 * Submits the batched pairings that no open batch already carries, then waits for every open batch.
 *
 * One batch per judge per call of this step. The state file is written before waiting, so stopping the
 * runner and starting it again resumes the wait.
 */
async function runBatches(pendings: Pending[], counts: StepCounts, options: JudgeOptions): Promise<void> {
	const states: BatchState[] = existsSync(options.batchStateFile) ? readJson<BatchState[]>(options.batchStateFile) : [];
	const byKey = new Map(pendings.map((pending) => [pending.key, pending]));
	const carried = new Set(states.filter((state) => !state.done).flatMap((state) => state.items.map((item) => item.key)));
	const fresh = pendings.filter((pending) => !carried.has(pending.key));
	if (fresh.length > 0) {
		const client = options.clients.anthropic;
		if (!client) throw new Error("ANTHROPIC_API_KEY is not set; add it to the evaluator's .env");
		for (const judgeId of new Set(fresh.map((pending) => pending.judge.id))) {
			const items = fresh.filter((pending) => pending.judge.id === judgeId);
			const id = await submitAnthropicBatch(client, items.map((pending) => ({ customId: customIdFor(pending.key), call: pending.call })));
			states.push({ id, judge_id: judgeId, submitted_at: new Date().toISOString(), done: false, items: items.map((pending) => ({ custom_id: customIdFor(pending.key), key: pending.key })) });
			writeJson(options.batchStateFile, states);
			options.log(`batch ${id} submitted: ${items.length} × ${judgeId}`);
		}
	}
	for (const state of states.filter((entry) => !entry.done)) {
		await waitForBatch(state, byKey, counts, options);
		state.done = true;
		writeJson(options.batchStateFile, states);
	}
}

/** Polls one batch until it ends, then records every result whose pairing is still wanted. */
async function waitForBatch(state: BatchState, byKey: Map<string, Pending>, counts: StepCounts, options: JudgeOptions): Promise<void> {
	const client = options.clients.anthropic;
	if (!client) throw new Error("ANTHROPIC_API_KEY is not set; add it to the evaluator's .env");
	for (;;) {
		const status = await anthropicBatchStatus(client, state.id);
		if (status.ended) break;
		options.log(`batch ${state.id}: ${status.counts.processing} processing, ${status.counts.succeeded} done`);
		await new Promise((resolve) => setTimeout(resolve, options.pollMs));
	}
	const outcomes = await anthropicBatchResults(client, state.id);
	for (const item of state.items) {
		const pending = byKey.get(item.key);
		if (!pending) continue;
		const outcome = outcomes.get(item.custom_id) ?? { error: "missing from the batch results" };
		const record = toRecord(pending, state.submitted_at, {
			result: outcome.result,
			cost: outcome.result ? callCostUsd(pending.call, outcome.result, { batch: true }) : undefined,
			error: outcome.error,
			batch: true,
		});
		finish(record, counts, options);
	}
}
