import type { RequestHandler } from "./$types";
import { chat } from "#lib/server/openrouter.js";
import { REASONING_EFFORTS, isReasoningEffort } from "#lib/config/reasoning.js";

/**
 * Reasoning counts against max_tokens. Claude Opus 5.5 at max effort wrote 36,545 output tokens judging one
 * 10-question quiz (measured 2026-10-20), so the old 16,384 would have cut its JSON off.
 */
const JUDGE_MAX_TOKENS = 64_000;

function getApiKey(request: Request): string | null {
	const auth = request.headers.get("Authorization");
	return auth?.replace(/^Bearer\s+/i, "")?.trim() || null;
}

export const POST: RequestHandler = async ({ request }) => {
	const apiKey = getApiKey(request);
	if (!apiKey) {
		return Response.json({ error: "Enter your API key above to fetch model prices" }, { status: 401 });
	}
	try {
		const body = await request.json();
		const { judge_model_id, judge_prompt, reasoning_effort } = body as {
			judge_model_id: string;
			judge_prompt: string;
			reasoning_effort?: unknown;
		};
		if (!judge_model_id || typeof judge_prompt !== "string") {
			return Response.json({ error: "judge_model_id and judge_prompt required" }, { status: 400 });
		}
		if (reasoning_effort != null && !isReasoningEffort(reasoning_effort)) {
			return Response.json({ error: `reasoning_effort must be one of ${REASONING_EFFORTS.join(", ")}` }, { status: 400 });
		}
		const result = await chat({
			apiKey,
			modelId: judge_model_id,
			messages: [{ role: "user", content: judge_prompt }],
			temperature: 0.3,
			maxTokens: JUDGE_MAX_TOKENS,
			response_format: { type: "json_object" },
			reasoningEffort: reasoning_effort ?? undefined,
		});
		return Response.json({
			raw_text: result.rawText,
			service_time_ms: result.serviceTimeMs,
			wall_time_ms: result.wallTimeMs,
			retry_count: result.retryCount,
			backoff_ms_total: result.backoffMsTotal,
			throttle_events: result.throttleEvents,
			usage: result.usage,
			cost: result.cost,
		});
	} catch (e) {
		const message = e instanceof Error ? e.message : "Server error";
		return Response.json({ error: message }, { status: 500 });
	}
};
