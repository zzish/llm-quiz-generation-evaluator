import type { JudgeResponse } from "$lib/types/judge";
import { isQuizEvalResponse } from "$lib/types/judge";
import type { ModelResult, SingleRun } from "$lib/types/run";

function mean(arr: number[]): number {
	if (arr.length === 0) return 0;
	return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[]): number {
	if (arr.length <= 1) return 0;
	const m = mean(arr);
	const variance = arr.reduce((sum, x) => sum + (x - m) ** 2, 0) / (arr.length - 1);
	return Math.sqrt(variance);
}

/**
 * Compute per-model aggregates from runs: time_avg/std, consistency_percent, quality/correctness/alignment/compliance avgs and stds, throttle_events, throttled_runs_percent.
 */
export function computeModelAggregates(
	modelId: string,
	modelLabel: string,
	runs: SingleRun[]
): ModelResult {
	const wallTimes = runs.map((r) => r.wall_time_ms).filter((t): t is number => typeof t === "number");
	const time_avg_ms = wallTimes.length > 0 ? mean(wallTimes) : 0;
	const time_std_ms = wallTimes.length > 1 ? std(wallTimes) : 0;
	// Consistency is generation-only: % of runs where quiz passed schema (judge success/failure does not affect it).
	const runsWithGenerationComplete = runs.filter((r) => r.quiz_raw_text !== "");
	const consistency_pass_count = runsWithGenerationComplete.filter((r) => r.consistency_pass).length;
	const consistency_percent = runsWithGenerationComplete.length > 0 ? (consistency_pass_count / runsWithGenerationComplete.length) * 100 : 0;
	const qualityScores = runs.map((r) => r.run_quality_avg).filter((q): q is number => typeof q === "number");
	const correctnessScores = runs.map((r) => r.run_correctness_avg).filter((c): c is number => typeof c === "number");
	const alignmentScores = runs.map((r) => r.run_alignment_avg).filter((a): a is number => typeof a === "number");
	const complianceScores = runs.map((r) => r.run_compliance_avg).filter((c): c is number => typeof c === "number");
	const quality_avg = qualityScores.length > 0 ? mean(qualityScores) : null;
	const quality_std = qualityScores.length > 1 ? std(qualityScores) : null;
	const correctness_avg = correctnessScores.length > 0 ? mean(correctnessScores) : null;
	const correctness_std = correctnessScores.length > 1 ? std(correctnessScores) : null;
	const alignment_avg = alignmentScores.length > 0 ? mean(alignmentScores) : null;
	const alignment_std = alignmentScores.length > 1 ? std(alignmentScores) : null;
	const compliance_avg = complianceScores.length > 0 ? mean(complianceScores) : null;
	const compliance_std = complianceScores.length > 1 ? std(complianceScores) : null;
	const throttle_events = runs.reduce((sum, r) => sum + (r.throttle_events ?? 0), 0);
	const throttled_runs_percent =
		runs.length > 0 ? (runs.filter((r) => (r.throttle_events ?? 0) > 0).length / runs.length) * 100 : 0;
	const runCosts = runs.map((r) => r.cost).filter((c): c is number => typeof c === "number" && !Number.isNaN(c));
	const cost_avg = runCosts.length > 0 ? mean(runCosts) : null;
	const cost_per_1000_runs = cost_avg != null ? cost_avg * 1000 : null;
	return {
		model_id: modelId,
		model_label: modelLabel,
		runs,
		time_avg_ms,
		time_std_ms,
		consistency_percent,
		quality_avg,
		quality_std,
		correctness_avg,
		correctness_std,
		alignment_avg,
		alignment_std,
		compliance_avg,
		compliance_std,
		throttle_events,
		throttled_runs_percent,
		cost_per_1000_runs,
	};
}

/**
 * Normalize a single JudgeResponse to run-level metrics (0–100).
 * QuizEval: overall_score, rubric correctness/alignment/compliance → correctness/alignment/compliance.
 * Legacy: correctness, appropriateness, relevance; quality = average of three; we map appropriateness→alignment, relevance→compliance.
 */
export function getNormalizedScores(parsed: JudgeResponse): {
	quality: number;
	correctness: number;
	alignment: number;
	compliance: number;
} {
	if (isQuizEvalResponse(parsed)) {
		const correctness = (parsed.rubric.correctness.score_0_4 / 4) * 100;
		const alignment = (parsed.rubric.alignment.score_0_4 / 4) * 100;
		const compliance = (parsed.rubric.compliance.score_0_4 / 4) * 100;
		return {
			quality: parsed.overall_score,
			correctness,
			alignment,
			compliance,
		};
	}
	const correctness = parsed.correctness;
	const alignment = parsed.appropriateness;
	const compliance = parsed.relevance;
	const quality = (correctness + alignment + compliance) / 3;
	return { quality, correctness, alignment, compliance };
}

/**
 * Compute run-level quality metrics from judge results (average across judges).
 * Supports both QuizEval and legacy judge response formats.
 */
export function computeRunQualityFromJudges(judgeResults: { parsed?: JudgeResponse }[]): {
	run_quality_avg: number;
	run_correctness_avg: number;
	run_alignment_avg: number;
	run_compliance_avg: number;
} | null {
	const valid = judgeResults.map((j) => j.parsed).filter((p): p is JudgeResponse => !!p);
	if (valid.length === 0) return null;
	const scores = valid.map(getNormalizedScores);
	const quality = scores.reduce((s, x) => s + x.quality, 0) / scores.length;
	const correctness = scores.reduce((s, x) => s + x.correctness, 0) / scores.length;
	const alignment = scores.reduce((s, x) => s + x.alignment, 0) / scores.length;
	const compliance = scores.reduce((s, x) => s + x.compliance, 0) / scores.length;
	return {
		run_quality_avg: quality,
		run_correctness_avg: correctness,
		run_alignment_avg: alignment,
		run_compliance_avg: compliance,
	};
}
