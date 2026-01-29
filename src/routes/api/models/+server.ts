import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

const OPENROUTER_MODELS = "https://openrouter.ai/api/v1/models";

function getApiKey(request: Request): string | null {
	const auth = request.headers.get("Authorization");
	return auth?.replace(/^Bearer\s+/i, "")?.trim() || null;
}

export const GET: RequestHandler = async ({ request }) => {
	const apiKey = getApiKey(request);
	if (!apiKey) {
		return json({ error: "Enter your API key above to fetch model prices" }, { status: 401 });
	}
	try {
		const res = await fetch(OPENROUTER_MODELS, {
			headers: { Authorization: `Bearer ${apiKey}` },
		});
		if (!res.ok) {
			return json(
				{ error: `OpenRouter models ${res.status}` },
				{ status: res.status >= 500 ? 503 : res.status }
			);
		}
		const data = (await res.json()) as { data?: Array<Record<string, unknown>> };
		const list = data.data ?? [];
		const safe = list.map((m) => ({
			id: m.id,
			name: m.name,
			pricing: m.pricing,
			context_length: m.context_length ?? (m.top_provider as { context_length?: number } | undefined)?.context_length,
		}));
		return json({ data: safe });
	} catch (e) {
		const message = e instanceof Error ? e.message : "Failed to fetch models";
		return json({ error: message }, { status: 503 });
	}
};
