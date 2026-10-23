import type { QuizOutput } from "./quiz";
import type { JudgeResponse } from "./judge";
import type { ReasoningEffort } from "#lib/config/reasoning.js";

export type RunStatus = "queued" | "running" | "complete" | "failed";

export interface UsageInfo {
	prompt_tokens: number;
	completion_tokens: number;
}

export interface JudgeResultItem {
	judge_model_id: string;
	judge_label: string;
	/** The `reasoning.effort` sent to the judge; absent when the model used its own default. */
	reasoning_effort?: ReasoningEffort;
	raw_text: string;
	parsed?: JudgeResponse;
	parse_error?: string;
	usage?: UsageInfo;
	cost?: number;
	service_time_ms?: number;
	wall_time_ms?: number;
}

export interface SingleRun {
	run_index: number;
	status: RunStatus;
	error?: string;
	service_time_ms?: number;
	wall_time_ms?: number;
	retry_count?: number;
	backoff_ms_total?: number;
	throttle_events: number;
	usage?: UsageInfo;
	cost?: number;
	consistency_pass: boolean;
	quiz_raw_text: string;
	quiz_json: QuizOutput | null;
	parse_error?: string;
	schema_errors: string[];
	judge_results: JudgeResultItem[];
	/** When use_enrichment_prompt: the expanded prompt text returned by the enrichment call. */
	enrichment_generated_prompt?: string;
	run_quality_avg?: number;
	run_correctness_avg?: number;
	run_alignment_avg?: number;
	run_compliance_avg?: number;
}

export interface ModelResult {
	model_id: string;
	model_label: string;
	runs: SingleRun[];
	time_avg_ms: number;
	time_std_ms: number;
	consistency_percent: number;
	quality_avg: number | null;
	quality_std: number | null;
	correctness_avg: number | null;
	correctness_std: number | null;
	alignment_avg: number | null;
	alignment_std: number | null;
	compliance_avg: number | null;
	compliance_std: number | null;
	throttle_events: number;
	throttled_runs_percent: number;
	/** Average cost per run (generation only) × 1000, or null if no cost data. */
	cost_per_1000_runs: number | null;
}

export interface RunPayload {
	run_id: string;
	started_at: number;
	learning_objective: string;
	request: string;
	full_prompt: string;
	use_enrichment_prompt?: boolean;
	runs_per_model: number;
	temperature: number;
	vary_temperature: boolean;
	max_concurrency: number;
	min_spacing_ms: number;
	selected_test_models: string[];
	selected_judge_models: string[];
	/** Reasoning effort per judge model id; a judge missing here used its model's default. */
	judge_reasoning_efforts?: Partial<Record<string, ReasoningEffort>>;
	model_results: ModelResult[];
	estimated_cost_usd?: number;
	actual_cost_usd?: number;
}

export interface StoredRun extends RunPayload {
	id?: number;
	saved_at: number;
}

export interface StoredRunSummary {
	id: number;
	run_id: string;
	started_at: number;
	learning_objective_snippet: string;
	request_snippet: string;
	model_count: number;
	quality_avg?: number;
}
