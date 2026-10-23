/**
 * OpenRouter's unified reasoning control, `reasoning.effort`, highest first.
 * Source: https://openrouter.ai/docs/guides/best-practices/reasoning-tokens (read 2026-10-20).
 */
export const REASONING_EFFORTS = ["max", "xhigh", "high", "medium", "low", "minimal", "none"] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
	return typeof value === "string" && (REASONING_EFFORTS as readonly string[]).includes(value);
}

/** The `reasoning` object OpenRouter's model list reports for each model. */
export interface ModelReasoningInfo {
	/** Highest first. `null` means every gateway value is accepted; absent means the model has no effort control. */
	supported_efforts?: string[] | null;
	/** The effort the model uses when the request names none. */
	default_effort?: string;
	default_enabled?: boolean;
	/** The model always reasons and rejects `"none"`. */
	mandatory?: boolean;
	supports_max_tokens?: boolean;
}

/** The efforts a selector should offer for one model, highest first. */
export function effortChoices(reasoning: ModelReasoningInfo | undefined): ReasoningEffort[] {
	if (!reasoning) return [];
	const listed: readonly string[] =
		reasoning.supported_efforts === null ? REASONING_EFFORTS : (reasoning.supported_efforts ?? []);
	return REASONING_EFFORTS.filter((effort) => listed.includes(effort) && !(reasoning.mandatory && effort === "none"));
}
