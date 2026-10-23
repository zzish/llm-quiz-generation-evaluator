/**
 * Shared shapes for calling a model through its own provider's API rather than OpenRouter.
 *
 * The headless batch runner (`scripts/eval`) uses these. The web UI keeps its OpenRouter route, so a
 * person running the app with their own key is unaffected.
 */

/** Providers the evaluator can call directly. */
export type ProviderId = "anthropic" | "azure" | "google" | "meta" | "inception" | "deepseek";

/** One call: a single user prompt in, text out. */
export interface ModelCall {
	/** Registry key, such as `anthropic:claude-opus-5-5`. */
	modelKey: string;
	/** Reasoning level in this model's own vocabulary (`max`, `high`, `instant`, `none` …). */
	reasoning: string;
	prompt: string;
	/** Ceiling on generated tokens. Reasoning tokens count against it on every provider used here. */
	maxOutputTokens: number;
	/** Ask for a JSON object where the provider has a switch for it. */
	json?: boolean;
}

/** Token counts as the provider reported them. */
export interface CallUsage {
	/** Every input token, cached or not. */
	inputTokens: number;
	/** Visible and reasoning output together, which is what providers bill. */
	outputTokens: number;
	/** The reasoning share of `outputTokens`, when the provider reports it separately. */
	reasoningTokens: number | null;
	/** The cached share of `inputTokens`. */
	cachedInputTokens: number;
}

/** Why generation stopped, in the same terms for every provider. */
export interface CallFinish {
	/** The provider's own word for it, kept for the record. */
	raw: string | null;
	/** The output limit cut the answer short. */
	truncated: boolean;
	/** The provider declined to answer. */
	refused: boolean;
}

/** What one call produced. */
export interface CallResult {
	text: string;
	usage: CallUsage;
	finish: CallFinish;
	latencyMs: number;
	/** The provider's response or request id, for tracing a call later. */
	responseId: string | null;
}
