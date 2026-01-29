/** OpenRouter model info from GET /api/v1/models (safe subset for client). */
export interface OpenRouterModelInfo {
	id: string;
	name?: string;
	pricing?: {
		prompt: string;
		completion: string;
	};
	context_length?: number;
}
