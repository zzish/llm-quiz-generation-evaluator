/** Assumed token sizes for a typical 10-question quiz (used for cost estimation). */
export const ASSUMED_TOKEN_SIZES = {
	/** Generation (test) call: learning objective + request + schema prompt. */
	generation: { input: 650, output: 950 },
	/** Enrichment call: objective + request + template in; expanded prompt out. */
	enrichment: { input: 500, output: 550 },
	/** Judge call: full prompt + quiz JSON + rubric. */
	judge: { input: 1800, output: 400 },
} as const;

/**
 * Multiplier applied to the raw cost estimate. OpenRouter pricing is per-token (USD);
 * our formula (input_tokens * prompt_price + output_tokens * completion_price) is correct,
 * but real usage (longer quizzes, more judge output, retries) often runs ~2× the assumed sizes.
 */
export const COST_ESTIMATE_SAFETY_FACTOR = 3;
