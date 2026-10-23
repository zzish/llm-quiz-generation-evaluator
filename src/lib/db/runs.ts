import type { RunPayload, StoredRun, StoredRunSummary } from "#lib/types/run.js";

const DB_NAME = "llm-evaluator-runs";
const STORE_NAME = "runs";
const KEY_PATH = "id";

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		req.onerror = () => reject(req.error);
		req.onsuccess = () => resolve(req.result);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				const store = db.createObjectStore(STORE_NAME, { keyPath: KEY_PATH, autoIncrement: true });
				store.createIndex("started_at", "started_at", { unique: false });
			}
		};
	});
}

/**
 * Save a run payload. Assigns id and saved_at. Returns the assigned id.
 * Uses JSON round-trip so IndexedDB receives plain objects (Svelte state is not cloneable).
 */
export async function saveRun(payload: RunPayload): Promise<number> {
	const db = await openDb();
	const record: StoredRun = {
		...payload,
		saved_at: Date.now(),
	};
	const plain = JSON.parse(JSON.stringify(record)) as StoredRun;
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readwrite");
		const store = tx.objectStore(STORE_NAME);
		const req = store.add(plain);
		req.onerror = () => reject(req.error);
		tx.oncomplete = () => {
			db.close();
			resolve(req.result as number);
		};
		tx.onerror = () => reject(tx.error);
	});
}

/**
 * Update an existing run by id. Overwrites the record with the new payload (e.g. after more evaluations complete).
 * Uses JSON round-trip so IndexedDB receives plain objects.
 */
export async function updateRun(id: number, payload: RunPayload): Promise<void> {
	const db = await openDb();
	const record: StoredRun = {
		...payload,
		id,
		saved_at: Date.now(),
	};
	const plain = JSON.parse(JSON.stringify(record)) as StoredRun;
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readwrite");
		const store = tx.objectStore(STORE_NAME);
		const req = store.put(plain);
		req.onerror = () => reject(req.error);
		tx.oncomplete = () => {
			db.close();
			resolve();
		};
		tx.onerror = () => reject(tx.error);
	});
}

/**
 * Get a stored run by id.
 */
export async function getRun(id: number): Promise<StoredRun | undefined> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readonly");
		const store = tx.objectStore(STORE_NAME);
		const req = store.get(id);
		req.onsuccess = () => resolve(req.result as StoredRun | undefined);
		req.onerror = () => reject(req.error);
		tx.oncomplete = () => db.close();
	});
}

function snippet(s: string, maxLen: number): string {
	if (typeof s !== "string") return "";
	return s.length <= maxLen ? s : s.slice(0, maxLen) + "...";
}

/**
 * List runs (newest first). Returns summaries for the runs list page.
 */
export async function listRuns(options?: {
	limit?: number;
	offset?: number;
}): Promise<StoredRunSummary[]> {
	const db = await openDb();
	const limit = options?.limit ?? 50;
	const offset = options?.offset ?? 0;
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readonly");
		const store = tx.objectStore(STORE_NAME);
		const index = store.index("started_at");
		const req = index.openCursor(null, "prev");
		const results: StoredRunSummary[] = [];
		let skipped = 0;
		req.onsuccess = () => {
			const cursor = req.result;
			if (!cursor) {
				db.close();
				resolve(results);
				return;
			}
			if (skipped < offset) {
				skipped++;
				cursor.continue();
				return;
			}
			if (results.length >= limit) {
				db.close();
				resolve(results);
				return;
			}
			const run = cursor.value as StoredRun;
			const id = run.id ?? cursor.primaryKey as number;
			const qualityAvg =
				run.model_results?.length > 0
					? run.model_results.reduce((sum, m) => sum + (m.quality_avg ?? 0), 0) / run.model_results.length
					: undefined;
			results.push({
				id,
				run_id: run.run_id,
				started_at: run.started_at,
				learning_objective_snippet: snippet(run.learning_objective, 60),
				request_snippet: snippet(run.request, 60),
				model_count: run.model_results?.length ?? 0,
				quality_avg: qualityAvg,
			});
			cursor.continue();
		};
		req.onerror = () => {
			db.close();
			reject(req.error);
		};
	});
}

/**
 * Delete a run by id.
 */
export async function deleteRun(id: number): Promise<void> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readwrite");
		const store = tx.objectStore(STORE_NAME);
		const req = store.delete(id);
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
		tx.oncomplete = () => db.close();
	});
}
