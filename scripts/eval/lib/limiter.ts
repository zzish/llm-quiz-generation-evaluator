/**
 * Caps how many calls run at once per provider.
 *
 * Each provider has its own rate limits, so one slow provider must not hold the others back, and Gemini's
 * tighter limits should not be flooded while Azure has room to spare.
 */

/** Runs tasks for a named lane, at most `limit` of them at a time. */
export interface Limiter {
	run<T>(lane: string, task: () => Promise<T>): Promise<T>;
}

/** A limiter whose per-lane caps come from `limits`, with `fallback` for lanes it does not name. */
export function createLimiter(limits: Record<string, number | undefined>, fallback = 2): Limiter {
	const active = new Map<string, number>();
	const waiting = new Map<string, Array<() => void>>();

	const acquire = async (lane: string): Promise<void> => {
		const cap = Math.max(1, limits[lane] ?? fallback);
		if ((active.get(lane) ?? 0) < cap) {
			active.set(lane, (active.get(lane) ?? 0) + 1);
			return;
		}
		await new Promise<void>((resolve) => {
			const queue = waiting.get(lane) ?? [];
			queue.push(resolve);
			waiting.set(lane, queue);
		});
	};

	// A slot passes straight to the next waiter, so the active count only drops when nobody waits.
	const release = (lane: string): void => {
		const next = waiting.get(lane)?.shift();
		if (next) next();
		else active.set(lane, (active.get(lane) ?? 1) - 1);
	};

	return {
		async run<T>(lane: string, task: () => Promise<T>): Promise<T> {
			await acquire(lane);
			try {
				return await task();
			} finally {
				release(lane);
			}
		},
	};
}
