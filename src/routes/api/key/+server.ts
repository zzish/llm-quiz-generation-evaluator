import type { RequestHandler } from "./$types";

const OPENROUTER_KEY_INFO = "https://openrouter.ai/api/v1/key";

function getApiKey(request: Request): string | null {
	const auth = request.headers.get("Authorization");
	return auth?.replace(/^Bearer\s+/i, "")?.trim() || null;
}

export const GET: RequestHandler = async ({ request }) => {
	const apiKey = getApiKey(request);
	if (!apiKey) {
		return Response.json({ error: "Enter your API key above to fetch model prices" }, { status: 401 });
	}
	try {
		const res = await fetch(OPENROUTER_KEY_INFO, {
			headers: { Authorization: `Bearer ${apiKey}` },
		});
		if (!res.ok) {
			return Response.json(
				{ error: `OpenRouter key info ${res.status}` },
				{ status: res.status >= 500 ? 503 : res.status }
			);
		}
		const data = await res.json();
		return Response.json(data);
	} catch (e) {
		const message = e instanceof Error ? e.message : "Failed to fetch key info";
		return Response.json({ error: message }, { status: 503 });
	}
};
