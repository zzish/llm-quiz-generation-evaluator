import type { JudgeResponse, LegacyJudgeResponse, QuizEvalJudgeResponse } from "#lib/types/judge.js";

/**
 * Try to extract and fix JSON from judge output (handles markdown, trailing commas, extra text).
 */
function extractJson(text: string): string {
	// Strip markdown code fence if present
	const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/m;
	const fenceMatch = text.match(fence);
	if (fenceMatch) text = fenceMatch[1].trim();
	// Find first { and last } to get a single JSON object (handles preamble/suffix)
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start !== -1 && end !== -1 && end > start) text = text.slice(start, end + 1);
	// Remove trailing commas before } or ] (common LLM mistake)
	text = text.replace(/,(\s*[}\]])/g, "$1");
	return text;
}

function score0to4(n: unknown): n is number {
	return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 4;
}

function rubricDim(obj: unknown): obj is { score_0_4: number; evidence: string } {
	return (
		obj != null &&
		typeof obj === "object" &&
		score0to4((obj as { score_0_4?: unknown }).score_0_4) &&
		typeof (obj as { evidence?: unknown }).evidence === "string"
	);
}

/**
 * Validate and normalize QuizEval response. Returns parse error if invalid.
 */
function validateQuizEval(data: unknown): data is QuizEvalJudgeResponse {
	if (data == null || typeof data !== "object") return false;
	const d = data as Record<string, unknown>;
	if (typeof d.overall_score !== "number" || d.overall_score < 0 || d.overall_score > 100) return false;
	if (typeof d.confidence !== "number" || d.confidence < 0 || d.confidence > 100) return false;
	const rubric = d.rubric;
	if (rubric == null || typeof rubric !== "object") return false;
	const r = rubric as Record<string, unknown>;
	const dims = [
		"compliance",
		"alignment",
		"correctness",
		"clarity",
		"difficulty",
		"coverage",
		"distractors_or_guidance",
		"pedagogy",
		"fairness_accessibility",
	];
	for (const key of dims) {
		if (!rubricDim(r[key])) return false;
	}
	if (!d.summary || typeof d.summary !== "object") return false;
	const sum = d.summary as Record<string, unknown>;
	if (typeof sum.verdict !== "string") return false;
	if (!Array.isArray(sum.top_strengths) || !Array.isArray(sum.top_issues)) return false;
	if (typeof sum.most_important_fix !== "string") return false;
	if (!d.constraint_checks || typeof d.constraint_checks !== "object") return false;
	if (!Array.isArray(d.question_audit)) return false;
	return true;
}

/**
 * Check if parsed object looks like legacy format (correctness, appropriateness, relevance 0-100).
 */
function isLegacyShape(data: unknown): data is LegacyJudgeResponse {
	if (data == null || typeof data !== "object") return false;
	const d = data as Record<string, unknown>;
	return (
		typeof d.correctness === "number" &&
		typeof d.appropriateness === "number" &&
		typeof d.relevance === "number" &&
		!(d.overall_score !== undefined && d.rubric !== undefined)
	);
}

/**
 * Parse judge response JSON. Accepts both QuizEval and legacy formats.
 * Returns parse error if invalid.
 */
export function parseJudgeResponse(
	raw: string
): { data: JudgeResponse; parseError?: string } | { data?: undefined; parseError: string } {
	const text = extractJson(raw.trim());
	if (!text) return { parseError: "Empty or no JSON object found" };
	try {
		const data = JSON.parse(text) as Record<string, unknown>;

		// Try QuizEval first
		if (validateQuizEval(data)) {
			return { data: data as QuizEvalJudgeResponse };
		}

		// Fallback: legacy format
		if (isLegacyShape(data)) {
			if (data.correctness < 0 || data.correctness > 100)
				return { parseError: "correctness must be 0-100" };
			if (data.appropriateness < 0 || data.appropriateness > 100)
				return { parseError: "appropriateness must be 0-100" };
			if (data.relevance < 0 || data.relevance > 100)
				return { parseError: "relevance must be 0-100" };
			const legacy: LegacyJudgeResponse = {
				correctness: data.correctness,
				appropriateness: data.appropriateness,
				relevance: data.relevance,
				notes: typeof data.notes === "string" ? data.notes : "",
				per_question: Array.isArray(data.per_question) ? (data.per_question as LegacyJudgeResponse["per_question"]) : undefined,
			};
			return { data: legacy };
		}

		return { parseError: "Invalid judge response: expected QuizEval schema or legacy correctness/appropriateness/relevance" };
	} catch (e) {
		return { parseError: e instanceof Error ? e.message : String(e) };
	}
}
