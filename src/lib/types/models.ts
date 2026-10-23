import type { ModelReasoningInfo } from "#lib/config/reasoning.js";

/** OpenRouter model info from GET /api/v1/models (safe subset for client). */
export interface OpenRouterModelInfo {
	id: string;
	name?: string;
	pricing?: {
		prompt: string;
		completion: string;
	};
	context_length?: number;
	/** Which reasoning efforts the model accepts; absent for models without reasoning. */
	reasoning?: ModelReasoningInfo;
}
