/**
 * The files the batch runner reads (a request suite, a run configuration, external quizzes) and the
 * records it writes (one JSON line per call).
 */
import type { CallFinish, CallUsage, ProviderId } from "#lib/server/providers/types.js";
import type { JudgeResponse } from "#lib/types/judge.js";
import type { QuizOutput } from "#lib/types/quiz.js";

/** One teacher request: a learning objective and what the teacher asked for. */
export interface SuiteRequest {
	id: string;
	learning_objective: string;
	request: string;
	tags?: string[];
	/** For a sourced request: the passage every question must come from. Only openly licensed text: every judge sees it. */
	source_text?: string;
	/** Where the passage comes from and under which licence. */
	source_ref?: string;
}

/** A frozen set of requests, versioned by its id. */
export interface Suite {
	id: string;
	requests: SuiteRequest[];
}

/** A model at one reasoning level, as a candidate that writes quizzes. */
export interface CandidateConfig {
	id: string;
	model: string;
	reasoning: string;
	note?: string;
}

/** A judge. `batch` sends a Claude judge through the Message Batches API at half price. */
export interface JudgeConfig {
	id: string;
	model: string;
	reasoning: string;
	batch?: boolean;
	note?: string;
}

/** Everything a run needs besides the requests. */
export interface RunConfig {
	candidates: CandidateConfig[];
	judges: JudgeConfig[];
	limits?: {
		candidateMaxOutputTokens?: number;
		judgeMaxOutputTokens?: number;
	};
	/** Calls in flight per provider. */
	concurrency?: Partial<Record<ProviderId, number>>;
}

/** A quiz written somewhere else (Notebook, the legacy AI quiz creator) to be judged as it is. */
export interface ExternalQuiz {
	quiz_key: string;
	source: string;
	learning_objective: string;
	request: string;
	/** The quiz as JSON, or as the raw text the generator produced. */
	quiz: QuizOutput | Record<string, unknown> | string;
	/** The passage the quiz had to come from, when it was a sourced request. */
	source_text?: string;
}

/**
 * A quiz written by a pipeline outside the evaluator (Notebook, the legacy AI quiz creator), with what writing it
 * took. A driver writes these; the import step turns each into a generation record, so the judges and the
 * summary treat it exactly like a candidate's quiz.
 */
export interface ExternalGeneration {
	request_id: string;
	config_id: string;
	run: number;
	/** The pipeline and its models, in words. */
	model: string;
	reasoning: string;
	started_at: string;
	/** From the request to the finished quiz, as the teacher waits for it. */
	latency_ms: number | null;
	usage: CallUsage | null;
	cost_usd: number | null;
	/** The quiz in the evaluator's JSON shape, or the raw text the pipeline produced; null when it produced none. */
	quiz: QuizOutput | Record<string, unknown> | string | null;
	error: string | null;
	/** What the driver recorded about the run. Kept in the driver's own file; not copied into the record. */
	detail?: Record<string, unknown>;
}

/** One candidate call. `key` is `request|config|run`. */
export interface GenerationRecord {
	kind: "generation";
	key: string;
	request_id: string;
	config_id: string;
	run: number;
	model: string;
	reasoning: string;
	learning_objective: string;
	request: string;
	/** The passage the quiz had to come from, for a sourced request; the judges see it too. */
	source_text?: string;
	started_at: string;
	latency_ms: number | null;
	usage: CallUsage | null;
	cost_usd: number | null;
	finish: CallFinish | null;
	raw_text: string;
	quiz_json: QuizOutput | null;
	parse_error: string | null;
	schema_errors: string[];
	consistency_pass: boolean;
	error: string | null;
}

/** One judge call on one quiz. `key` is `quiz|judge`. */
export interface JudgmentRecord {
	kind: "judgment";
	key: string;
	quiz_key: string;
	/** The candidate configuration that wrote the quiz, or null for an external quiz. */
	config_id: string | null;
	source: string;
	judge_id: string;
	model: string;
	reasoning: string;
	batch: boolean;
	started_at: string;
	latency_ms: number | null;
	usage: CallUsage | null;
	cost_usd: number | null;
	finish: CallFinish | null;
	raw_text: string;
	parsed: JudgeResponse | null;
	parse_error: string | null;
	error: string | null;
}

/** A quiz ready for the judges, whichever way it was produced. */
export interface JudgeableQuiz {
	quiz_key: string;
	config_id: string | null;
	source: string;
	learning_objective: string;
	request: string;
	/** Exactly what the judge prompt embeds. */
	quiz_text: string;
	/** For a sourced request: the passage, which switches the judge to the source-fidelity prompt. */
	source_text?: string;
}
