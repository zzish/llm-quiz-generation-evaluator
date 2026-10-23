/**
 * The summarize step: per candidate configuration (or external source), what the judges found and what
 * writing the quizzes cost; per judge, how reliably it answered and what it cost.
 *
 * The headline accuracy figure is the wrong-key rate per question: the share of questions where a judge
 * solved the question itself and got a different answer from the key. Rubric scores use the app's own
 * normalisation (`getNormalizedScores`), so they match what the web UI shows.
 */
import { getNormalizedScores } from "#lib/run-aggregates.js";
import { isQuizEvalResponse } from "#lib/types/judge.js";
import type { QuizEvalJudgeResponse } from "#lib/types/judge.js";
import { latestByKey } from "./files.js";
import type { GenerationRecord, JudgmentRecord } from "./types.js";

/** One candidate configuration's (or external source's) results. */
export interface GroupSummary {
	group: string;
	model: string | null;
	reasoning: string | null;
	quizzes_generated: number;
	schema_pass_percent: number | null;
	generation_errors: number;
	truncated: number;
	quizzes_judged: number;
	quality_avg: number | null;
	quality_sd: number | null;
	correctness_avg: number | null;
	alignment_avg: number | null;
	compliance_avg: number | null;
	/** Share of questions a judge found keyed wrong, averaged over judges and quizzes (0–1). */
	wrong_key_rate: number | null;
	/** Share of judged quizzes where most judges flagged at least one wrong key (0–1). */
	flagged_quiz_rate: number | null;
	latency_p50_s: number | null;
	latency_p90_s: number | null;
	cost_per_quiz_usd: number | null;
	generation_cost_usd: number;
}

/** One judge's reliability and cost. */
export interface JudgeSummary {
	judge: string;
	model: string;
	reasoning: string;
	calls: number;
	errors: number;
	parse_failures: number;
	truncated: number;
	quality_avg: number | null;
	latency_p50_s: number | null;
	cost_per_call_usd: number | null;
	cost_usd: number;
}

export interface RunSummary {
	groups: GroupSummary[];
	judges: JudgeSummary[];
	totals: { generation_usd: number; judging_usd: number };
}

const mean = (values: number[]): number | null => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

const sd = (values: number[]): number | null => {
	const average = mean(values);
	if (average === null || values.length < 2) return null;
	return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
};

/** The q-th quantile (0–1) by linear interpolation, or null for no values. */
export function quantile(values: number[], q: number): number | null {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const position = (sorted.length - 1) * q;
	const lower = Math.floor(position);
	const upper = Math.ceil(position);
	return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/** What one parsed judgment says about one quiz. */
interface Verdict {
	quality: number;
	correctness: number;
	alignment: number;
	compliance: number;
	questions: number;
	wrongKeys: number;
}

/** A judgment's scores and key audit, or null when it did not produce a QuizEval answer. */
export function verdictOf(record: JudgmentRecord): Verdict | null {
	if (record.error || !record.parsed || !isQuizEvalResponse(record.parsed)) return null;
	const parsed: QuizEvalJudgeResponse = record.parsed;
	const scores = getNormalizedScores(parsed);
	const audit = Array.isArray(parsed.question_audit) ? parsed.question_audit : [];
	return {
		...scores,
		questions: audit.length,
		wrongKeys: audit.filter((question) => question.key_matches === false).length,
	};
}

/** Builds the run summary from every record (later attempts replace earlier ones). */
export function summarize(generationRecords: GenerationRecord[], judgmentRecords: JudgmentRecord[]): RunSummary {
	const generations = [...latestByKey(generationRecords).values()];
	const judgments = [...latestByKey(judgmentRecords).values()];
	const verdictsByQuiz = new Map<string, { group: string; verdicts: Verdict[] }>();
	for (const judgment of judgments) {
		const verdict = verdictOf(judgment);
		if (!verdict) continue;
		const group = judgment.config_id ?? `external:${judgment.source}`;
		const entry = verdictsByQuiz.get(judgment.quiz_key) ?? { group, verdicts: [] };
		entry.verdicts.push(verdict);
		verdictsByQuiz.set(judgment.quiz_key, entry);
	}

	const groupNames = new Set([...generations.map((record) => record.config_id), ...[...verdictsByQuiz.values()].map((entry) => entry.group)]);
	const groups = [...groupNames].sort().map((group) => summarizeGroup(group, generations, verdictsByQuiz));
	const judgeIds = [...new Set(judgments.map((record) => record.judge_id))].sort();
	const judgesSummary = judgeIds.map((id) => summarizeJudge(judgments.filter((record) => record.judge_id === id)));
	return {
		groups,
		judges: judgesSummary,
		totals: {
			generation_usd: generations.reduce((sum, record) => sum + (record.cost_usd ?? 0), 0),
			judging_usd: judgments.reduce((sum, record) => sum + (record.cost_usd ?? 0), 0),
		},
	};
}

/** One group's line: generation figures from its records, accuracy from its quizzes' verdicts. */
function summarizeGroup(group: string, generations: GenerationRecord[], verdictsByQuiz: Map<string, { group: string; verdicts: Verdict[] }>): GroupSummary {
	const own = generations.filter((record) => record.config_id === group);
	const written = own.filter((record) => !record.error);
	const quizzes = [...verdictsByQuiz.values()].filter((entry) => entry.group === group);
	const perQuiz = quizzes.map((entry) => ({
		quality: mean(entry.verdicts.map((v) => v.quality)) ?? 0,
		correctness: mean(entry.verdicts.map((v) => v.correctness)) ?? 0,
		alignment: mean(entry.verdicts.map((v) => v.alignment)) ?? 0,
		compliance: mean(entry.verdicts.map((v) => v.compliance)) ?? 0,
		wrongKeyRate: mean(entry.verdicts.filter((v) => v.questions > 0).map((v) => v.wrongKeys / v.questions)),
		flagged: entry.verdicts.filter((v) => v.wrongKeys > 0).length * 2 > entry.verdicts.length,
	}));
	const latencies = written.map((record) => (record.latency_ms ?? 0) / 1000);
	const costs = written.map((record) => record.cost_usd ?? 0);
	return {
		group,
		model: own[0]?.model ?? null,
		reasoning: own[0]?.reasoning ?? null,
		quizzes_generated: written.length,
		schema_pass_percent: written.length ? (100 * written.filter((record) => record.consistency_pass).length) / written.length : null,
		generation_errors: own.length - written.length,
		truncated: written.filter((record) => record.finish?.truncated).length,
		quizzes_judged: perQuiz.length,
		quality_avg: mean(perQuiz.map((quiz) => quiz.quality)),
		quality_sd: sd(perQuiz.map((quiz) => quiz.quality)),
		correctness_avg: mean(perQuiz.map((quiz) => quiz.correctness)),
		alignment_avg: mean(perQuiz.map((quiz) => quiz.alignment)),
		compliance_avg: mean(perQuiz.map((quiz) => quiz.compliance)),
		wrong_key_rate: mean(perQuiz.flatMap((quiz) => (quiz.wrongKeyRate === null ? [] : [quiz.wrongKeyRate]))),
		flagged_quiz_rate: perQuiz.length ? perQuiz.filter((quiz) => quiz.flagged).length / perQuiz.length : null,
		latency_p50_s: quantile(latencies, 0.5),
		latency_p90_s: quantile(latencies, 0.9),
		cost_per_quiz_usd: mean(costs),
		generation_cost_usd: costs.reduce((a, b) => a + b, 0),
	};
}

/** One judge's line. */
function summarizeJudge(records: JudgmentRecord[]): JudgeSummary {
	const answered = records.filter((record) => !record.error);
	const verdicts = answered.map(verdictOf).filter((verdict): verdict is Verdict => verdict !== null);
	const timed = answered.filter((record) => record.latency_ms !== null).map((record) => (record.latency_ms ?? 0) / 1000);
	const costs = answered.map((record) => record.cost_usd ?? 0);
	return {
		judge: records[0].judge_id,
		model: records[0].model,
		reasoning: records[0].reasoning,
		calls: records.length,
		errors: records.length - answered.length,
		parse_failures: answered.length - verdicts.length,
		truncated: answered.filter((record) => record.finish?.truncated).length,
		quality_avg: mean(verdicts.map((verdict) => verdict.quality)),
		latency_p50_s: quantile(timed, 0.5),
		cost_per_call_usd: mean(costs),
		cost_usd: costs.reduce((a, b) => a + b, 0),
	};
}

const fmt = (value: number | null, digits = 1): string => (value === null ? "–" : value.toFixed(digits));
const pct = (value: number | null): string => (value === null ? "–" : `${(100 * value).toFixed(1)}%`);
const usd = (value: number | null): string => (value === null ? "–" : `$${value.toFixed(4)}`);

/** The summary as Markdown tables, for reading in a terminal or an editor. */
export function summaryMarkdown(summary: RunSummary): string {
	const lines = [
		"## Candidates",
		"",
		"| Config | Model | Reasoning | Quizzes | Schema ok | Judged | Quality | Correctness | Alignment | Compliance | Wrong keys / question | Flagged quizzes | p50 s | p90 s | $ / quiz |",
		"| -- | -- | -- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |",
		...summary.groups.map(
			(group) =>
				`| ${group.group} | ${group.model ?? "–"} | ${group.reasoning ?? "–"} | ${group.quizzes_generated} | ${group.schema_pass_percent === null ? "–" : `${group.schema_pass_percent.toFixed(0)}%`} | ${group.quizzes_judged} | ${fmt(group.quality_avg)}${group.quality_sd === null ? "" : ` ± ${fmt(group.quality_sd)}`} | ${fmt(group.correctness_avg)} | ${fmt(group.alignment_avg)} | ${fmt(group.compliance_avg)} | ${pct(group.wrong_key_rate)} | ${pct(group.flagged_quiz_rate)} | ${fmt(group.latency_p50_s)} | ${fmt(group.latency_p90_s)} | ${usd(group.cost_per_quiz_usd)} |`,
		),
		"",
		"## Judges",
		"",
		"| Judge | Model | Reasoning | Calls | Errors | Parse failures | Truncated | Mean quality | p50 s | $ / call | $ total |",
		"| -- | -- | -- | --: | --: | --: | --: | --: | --: | --: | --: |",
		...summary.judges.map(
			(judge) =>
				`| ${judge.judge} | ${judge.model} | ${judge.reasoning} | ${judge.calls} | ${judge.errors} | ${judge.parse_failures} | ${judge.truncated} | ${fmt(judge.quality_avg)} | ${fmt(judge.latency_p50_s)} | ${usd(judge.cost_per_call_usd)} | ${usd(judge.cost_usd)} |`,
		),
		"",
		`Generation $${summary.totals.generation_usd.toFixed(4)} · judging $${summary.totals.judging_usd.toFixed(4)} (list prices).`,
		"",
	];
	return lines.join("\n");
}
