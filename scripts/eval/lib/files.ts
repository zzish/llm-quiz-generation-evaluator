/** Reading and appending the runner's JSON and JSON-lines files. */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** A JSON file's contents. */
export function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Writes pretty JSON, creating the folder first. */
export function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Every line of a JSON-lines file, or nothing when the file does not exist yet. Blank lines are skipped. */
export function readJsonl<T>(path: string): T[] {
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8")
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line) => JSON.parse(line) as T);
}

/**
 * Appends one record as a line, creating the folder first.
 *
 * Each record is written the moment its call finishes, so a run that stops halfway loses at most the
 * calls still in flight, and the next run picks up from the file.
 */
export function appendJsonl(path: string, record: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	appendFileSync(path, `${JSON.stringify(record)}\n`);
}

/** The last record for each key: a later attempt replaces an earlier one. */
export function latestByKey<T extends { key: string }>(records: T[]): Map<string, T> {
	const latest = new Map<string, T>();
	for (const record of records) latest.set(record.key, record);
	return latest;
}
