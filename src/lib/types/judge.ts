/** Legacy judge output (correctness, appropriateness, relevance 0–100). */
export interface LegacyJudgeResponse {
	correctness: number;
	appropriateness: number;
	relevance: number;
	notes: string;
	per_question?: LegacyPerQuestionScore[];
}

export interface LegacyPerQuestionScore {
	id: number;
	correctness: number;
	appropriateness: number;
	relevance: number;
	issues: string[];
}

/** QuizEval rubric dimension (0–4 + evidence). */
export interface RubricDimension {
	score_0_4: number;
	evidence: string;
}

/** QuizEval rubric (all dimensions). */
export interface QuizEvalRubric {
	compliance: RubricDimension;
	alignment: RubricDimension;
	correctness: RubricDimension;
	clarity: RubricDimension;
	difficulty: RubricDimension;
	coverage: RubricDimension;
	distractors_or_guidance: RubricDimension;
	pedagogy: RubricDimension;
	fairness_accessibility: RubricDimension;
}

/** QuizEval question audit entry. */
export interface QuestionAuditItem {
	q_number: number;
	id: string | null;
	alignment_0_4: number;
	correctness_0_4: number;
	clarity_0_4: number;
	difficulty_0_4: number;
	distractors_or_guidance_0_4: number;
	linguistic_complexity: "too_high" | "appropriate" | "too_low";
	reading_level_mismatch: boolean;
	computed_correct_answer: string;
	key_matches: boolean;
	verification_note?: string;
	issues: string[];
	minimal_fix: string;
}

/** QuizEval constraint checks. */
export interface ConstraintChecks {
	requested_question_count: number | null;
	actual_question_count: number;
	count_ok: boolean;
	format_ok: boolean;
	notes: string;
}

/** QuizEval full response schema. */
export interface QuizEvalJudgeResponse {
	overall_score: number;
	confidence: number;
	objective_text_missing?: boolean;
	summary: {
		verdict: "excellent" | "good" | "mixed" | "poor";
		top_strengths: string[];
		top_issues: string[];
		most_important_fix: string;
	};
	rubric: QuizEvalRubric;
	language_accessibility: {
		linguistic_complexity_overall: "too_high" | "appropriate" | "too_low";
		notes: string;
	};
	question_audit: QuestionAuditItem[];
	constraint_checks: ConstraintChecks;
}

/** Discriminated union: new QuizEval vs legacy. */
export type JudgeResponse = QuizEvalJudgeResponse | LegacyJudgeResponse;

/** Type guard: response is QuizEval format. */
export function isQuizEvalResponse(r: JudgeResponse): r is QuizEvalJudgeResponse {
	return "overall_score" in r && "rubric" in r && typeof (r as QuizEvalJudgeResponse).rubric?.correctness === "object";
}
