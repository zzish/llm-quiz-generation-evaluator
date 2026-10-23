/**
 * Token sizes for one 10-question quiz, used for the cost estimate. Measured 2026-10-20 on one learning objective
 * (CCSS HSA.REI.B.4.B) through the providers' own APIs: two generations and twelve judgments.
 */
export const ASSUMED_TOKEN_SIZES = {
	/** Generation call: the larger of GPT-6 Luna (158 in, 1,647 out) and Claude Haiku 5.5 at low effort (249 in, 3,981 out). */
	generation: { input: 250, output: 4000 },
	/** Enrichment call: objective + request + template in; expanded prompt out. Not re-measured. */
	enrichment: { input: 500, output: 550 },
	/** Judge call: the median prompt was 3,372 tokens. Output is per judge, below; this is the fallback. */
	judge: { input: 3400, output: 9500 },
} as const;

/**
 * Output tokens per judgment, reasoning included, at the highest effort each judge offers (median of three
 * judgments, measured 2026-10-20). Lower efforts write fewer tokens, so these make the judge estimate an upper bound.
 */
export const JUDGE_OUTPUT_TOKENS_AT_HIGHEST_EFFORT: Readonly<Record<string, number>> = {
	"openai/gpt-6-astra": 9527, // max
	"anthropic/claude-opus-5.5": 36270, // max
	"google/gemini-4-argon": 6968, // high, its highest
	"meta/muse-wonder": 8188, // max
};

/**
 * Multiplier applied to the raw estimate, for longer quizzes and retries. The judge sizes above are already
 * upper bounds, so this mostly covers generation.
 */
export const COST_ESTIMATE_SAFETY_FACTOR = 1.5;
