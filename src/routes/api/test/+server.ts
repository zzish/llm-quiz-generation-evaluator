import type { RequestHandler } from "./$types";
import { chat } from "#lib/server/openrouter.js";

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
		const { model_id, full_prompt, temperature } = body as {
			model_id: string;
			full_prompt: string;
			temperature?: number;
		};
		if (!model_id || typeof full_prompt !== "string") {
			return Response.json({ error: "model_id and full_prompt required" }, { status: 400 });
		}
		const result = await chat({
			apiKey,
			modelId: model_id,
			messages: [{ role: "user", content: full_prompt }],
			temperature: temperature ?? 0.7,
			maxTokens: 8192,
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
