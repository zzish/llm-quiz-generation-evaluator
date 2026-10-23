/**
 * A spending ceiling for one run, so a configuration mistake cannot turn into a surprise bill.
 *
 * Calls already in flight finish (their cost is not known until they do), so a run can end slightly
 * above the ceiling; no new call starts once it is reached.
 */

/** The running total and the ceiling it is checked against. */
export interface Budget {
	readonly maxUsd: number | null;
	spentUsd: number;
	/** True once the ceiling is reached; a run stops scheduling calls from then on. */
	exhausted(): boolean;
	add(usd: number | null): void;
}

/** A budget with `maxUsd` as its ceiling, or none when `maxUsd` is null. */
export function createBudget(maxUsd: number | null): Budget {
	return {
		maxUsd,
		spentUsd: 0,
		exhausted() {
			return this.maxUsd !== null && this.spentUsd >= this.maxUsd;
		},
		add(usd) {
			if (typeof usd === "number" && Number.isFinite(usd)) this.spentUsd += usd;
		},
	};
}
