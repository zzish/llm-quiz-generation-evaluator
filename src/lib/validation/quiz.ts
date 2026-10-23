import type { QuizOutput } from "#lib/types/quiz.js";

const ALLOWED_QUESTION_TYPES = ["multiple_choice"] as const;

/**
 * Fix invalid JSON escape sequences (e.g. LaTeX \( \) or \pm in string values).
 * JSON only allows: \" \\ \/ \b \f \n \r \t \uXXXX.
 * Doubles any backslash not starting a valid escape, but only when that backslash
 * is not already escaped (so we don't turn valid \\pm into invalid \\\pm).
 */
function fixInvalidJsonEscapes(text: string): string {
	return text.replace(/(?<!\\)\\([^"\\/bfnrtu]|u(?![0-9a-fA-F]{4}))/g, "\\\\$1");
}

/**
 * Strip markdown code fences if present, fix invalid escapes, then JSON.parse. Returns parse error if invalid.
 */
export function parseQuiz(raw: string): { data: QuizOutput; parseError?: string } | { data?: undefined; parseError: string } {
	let text = raw.trim();
	// Full fence (opening + closing)
	const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/m;
	const match = text.match(fence);
	if (match) {
		text = match[1].trim();
	} else if (/^```(?:json)?\s*\n?/.test(text)) {
		// Opening fence only (e.g. model omitted closing ``` or response truncated)
		text = text.replace(/^```(?:json)?\s*\n?/, "").trim();
	}
	text = fixInvalidJsonEscapes(text);
	try {
		const data = JSON.parse(text) as QuizOutput;
		return { data };
	} catch (e) {
		const errMsg = e instanceof Error ? e.message : String(e);
		// Try to repair truncated JSON (e.g. "Unterminated string" or "Unexpected end of JSON input")
		if (
			errMsg.includes("Unterminated string") ||
			errMsg.includes("Unexpected end of JSON input")
		) {
			try {
				const repaired = text + '"}]}';
				const data = JSON.parse(repaired) as QuizOutput;
				return { data };
			} catch {
				// Repair failed, fall through to original error
			}
		}
		return { parseError: errMsg };
	}
}

/**
 * Validate parsed quiz: root keys, non-empty questions, required fields, type, answer_index, unique ids.
 */
export function validateQuizSchema(data: unknown): { valid: boolean; errors: string[] } {
	const errors: string[] = [];
	if (!data || typeof data !== "object") {
		return { valid: false, errors: ["Root must be an object"] };
	}
	const obj = data as Record<string, unknown>;
	if (typeof obj.quiz_title !== "string") errors.push("Missing or invalid quiz_title");
	if (typeof obj.learning_objective !== "string") errors.push("Missing or invalid learning_objective");
	if (!Array.isArray(obj.questions)) {
		errors.push("questions must be an array");
		return { valid: false, errors };
	}
	const questions = obj.questions as unknown[];
	if (questions.length === 0) errors.push("questions must be non-empty");
	const seenIds = new Set<number>();
	for (let i = 0; i < questions.length; i++) {
		const q = questions[i];
		if (!q || typeof q !== "object") {
			errors.push(`questions[${i}] must be an object`);
			continue;
		}
		const qq = q as Record<string, unknown>;
		if (typeof qq.id !== "number") errors.push(`questions[${i}].id must be a number`);
		else if (seenIds.has(qq.id)) errors.push(`questions[${i}].id duplicate id ${qq.id}`);
		else seenIds.add(qq.id);
		if (!ALLOWED_QUESTION_TYPES.includes((qq.type as string) as (typeof ALLOWED_QUESTION_TYPES)[0]))
			errors.push(`questions[${i}].type must be one of: ${ALLOWED_QUESTION_TYPES.join(", ")}`);
		if (typeof qq.question !== "string") errors.push(`questions[${i}].question must be a string`);
		if (!Array.isArray(qq.choices) || qq.choices.some((c: unknown) => typeof c !== "string"))
			errors.push(`questions[${i}].choices must be an array of strings`);
		const idx = qq.answer_index as number;
		if (typeof idx !== "number" || idx < 0 || (Array.isArray(qq.choices) && idx >= (qq.choices as unknown[]).length))
			errors.push(`questions[${i}].answer_index must be a valid index into choices`);
		if (typeof qq.explanation !== "string") errors.push(`questions[${i}].explanation must be a string`);
	}
	return { valid: errors.length === 0, errors };
}
