import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { chat } from "$lib/server/openrouter";

function getApiKey(request: Request): string | null {
	const auth = request.headers.get("Authorization");
	return auth?.replace(/^Bearer\s+/i, "")?.trim() || null;
}

export const POST: RequestHandler = async ({ request }) => {
	const apiKey = getApiKey(request);
	if (!apiKey) {
		return json({ error: "Enter your API key above to fetch model prices" }, { status: 401 });
	}
	try {
		const body = await request.json();
		const { judge_model_id, judge_prompt } = body as {
			judge_model_id: string;
			judge_prompt: string;
		};
		if (!judge_model_id || typeof judge_prompt !== "string") {
			return json({ error: "judge_model_id and judge_prompt required" }, { status: 400 });
		}
		const result = await chat({
			apiKey,
			modelId: judge_model_id,
			messages: [{ role: "user", content: judge_prompt }],
			temperature: 0.3,
			maxTokens: 16384,
			response_format: { type: "json_object" },
		});
		return json({
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
		return json({ error: message }, { status: 500 });
	}
};
