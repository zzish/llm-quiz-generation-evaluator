/**
 * Headless batch runner for the quiz-quality measurements: candidates write quizzes, the judge panel
 * scores them, and the results are summarised, all through each provider's own API.
 *
 *   npm run eval -- models
 *   npm run eval -- generate  --suite FILE --config FILE --out DIR [--runs N] [--only ids] [--retry-errors] [--max-cost USD]
 *   npm run eval -- import    --suite FILE --from FILE --out DIR [--retry-errors]
 *   npm run eval -- judge     --config FILE --out DIR [--quizzes FILE] [--quiz-keys FILE] [--only ids] [--retry-errors] [--max-cost USD]
 *   npm run eval -- summarize --out DIR
 *
 * `import` takes quizzes a pipeline outside the evaluator wrote (Notebook, the legacy AI quiz creator; one
 * external-generation JSON line each) and records them like candidates' quizzes. `--quiz-keys` limits a judge
 * step to the quizzes listed in a file, one key per line — how disputed quizzes are sent to a tie-breaker.
 *
 * DIR collects generations.jsonl, judgments.jsonl, batches.json and the summary. Keep it outside the
 * repository: it holds prompts and quizzes. Every step skips work already recorded there, so a stopped
 * run continues where it left off. Keys come from the evaluator's .env; a missing key only matters for
 * the provider that needs it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createClients } from "#lib/server/providers/call.js";
import { MODEL_REGISTRY } from "#lib/server/providers/registry.js";
import { createBudget } from "./lib/budget.js";
import { readJson, readJsonl, writeJson } from "./lib/files.js";
import { generate } from "./lib/generate.js";
import type { StepCounts } from "./lib/generate.js";
import { importGenerations } from "./lib/import.js";
import { judge, quizzesFromExternal, quizzesFromGenerations } from "./lib/judge.js";
import { createLimiter } from "./lib/limiter.js";
import { summarize, summaryMarkdown } from "./lib/summary.js";
import type { ExternalGeneration, ExternalQuiz, GenerationRecord, JudgmentRecord, RunConfig, Suite } from "./lib/types.js";

/** Calls in flight per provider when the configuration does not say. Gemini is kept low for its tighter rate limits. */
const DEFAULT_CONCURRENCY: Record<string, number> = { anthropic: 4, azure: 6, google: 2, meta: 3, inception: 4, deepseek: 4 };

const { positionals, values } = parseArgs({
	allowPositionals: true,
	options: {
		suite: { type: "string" },
		config: { type: "string" },
		out: { type: "string" },
		quizzes: { type: "string" },
		"quiz-keys": { type: "string" },
		from: { type: "string" },
		runs: { type: "string", default: "1" },
		only: { type: "string" },
		"retry-errors": { type: "boolean", default: false },
		"max-cost": { type: "string" },
		"poll-seconds": { type: "string", default: "30" },
	},
});

const log = (line: string) => console.log(line);

/** A required flag's value, or exit with a message naming it. */
function need(name: string, value: string | undefined): string {
	if (!value) {
		console.error(`--${name} is required for this command`);
		process.exit(2);
	}
	return value;
}

const idSet = (raw: string | undefined): Set<string> | null => (raw ? new Set(raw.split(",").map((id) => id.trim()).filter(Boolean)) : null);

/** Quiz keys from a file, one per line; blank lines and `#` comments are ignored. */
function quizKeysFrom(path: string): Set<string> {
	return new Set(
		readFileSync(path, "utf8")
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line && !line.startsWith("#")),
	);
}

/** The end-of-step line. */
function report(step: string, counts: StepCounts, spentUsd: number): void {
	const stopped = counts.notStarted ? `, ${counts.notStarted} not started (cost ceiling reached)` : "";
	log(`${step}: ${counts.ran} done, ${counts.failed} failed, ${counts.skipped} already recorded${stopped}; spent $${spentUsd.toFixed(4)} at list prices`);
}

async function main(): Promise<void> {
	const command = positionals[0];
	if (command === "models") {
		for (const entry of MODEL_REGISTRY.values()) {
			log(`${entry.key.padEnd(34)} ${entry.label.padEnd(32)} levels: ${entry.levels.join(", ").padEnd(40)} $${entry.pricing.input} in / $${entry.pricing.output} out per 1M`);
		}
		return;
	}
	if (command !== "generate" && command !== "import" && command !== "judge" && command !== "summarize") {
		console.error("Usage: npm run eval -- <models | generate | import | judge | summarize> [flags]; see scripts/eval/run.ts");
		process.exit(2);
	}

	const out = need("out", values.out);
	const files = {
		generations: join(out, "generations.jsonl"),
		judgments: join(out, "judgments.jsonl"),
		batches: join(out, "batches.json"),
	};

	if (command === "summarize") {
		const summary = summarize(readJsonl<GenerationRecord>(files.generations), readJsonl<JudgmentRecord>(files.judgments));
		writeJson(join(out, "summary.json"), summary);
		const markdown = summaryMarkdown(summary);
		writeFileSync(join(out, "summary.md"), markdown);
		log(markdown);
		return;
	}

	if (command === "import") {
		const counts = importGenerations({
			suite: readJson<Suite>(need("suite", values.suite)),
			items: readJsonl<ExternalGeneration>(need("from", values.from)),
			outFile: files.generations,
			retryErrors: values["retry-errors"] ?? false,
			log,
		});
		log(`import: ${counts.ran} recorded, ${counts.failed} recorded as failed, ${counts.skipped} already recorded; nothing was called`);
		return;
	}

	const config = readJson<RunConfig>(need("config", values.config));
	const clients = createClients(process.env);
	const limiter = createLimiter({ ...DEFAULT_CONCURRENCY, ...config.concurrency });
	const budget = createBudget(values["max-cost"] ? Number(values["max-cost"]) : null);

	if (command === "generate") {
		const counts = await generate({
			suite: readJson<Suite>(need("suite", values.suite)),
			config,
			outFile: files.generations,
			runs: Math.max(1, Number(values.runs)),
			only: idSet(values.only),
			retryErrors: values["retry-errors"] ?? false,
			clients,
			limiter,
			budget,
			log,
		});
		report("generate", counts, budget.spentUsd);
		return;
	}

	const all = values.quizzes
		? quizzesFromExternal(readJsonl<ExternalQuiz>(values.quizzes))
		: quizzesFromGenerations(readJsonl<GenerationRecord>(files.generations));
	const wanted = values["quiz-keys"] ? quizKeysFrom(values["quiz-keys"]) : null;
	const quizzes = wanted ? all.filter((quiz) => wanted.has(quiz.quiz_key)) : all;
	if (wanted && quizzes.length < wanted.size) {
		log(`${wanted.size - quizzes.length} listed quiz keys have no quiz to judge`);
	}
	log(`judging ${quizzes.length} quizzes`);
	const counts = await judge({
		quizzes,
		config,
		only: idSet(values.only),
		outFile: files.judgments,
		batchStateFile: files.batches,
		retryErrors: values["retry-errors"] ?? false,
		clients,
		limiter,
		budget,
		log,
		pollMs: Math.max(5, Number(values["poll-seconds"])) * 1000,
	});
	report("judge", counts, budget.spentUsd);
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
