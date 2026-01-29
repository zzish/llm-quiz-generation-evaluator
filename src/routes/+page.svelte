<script lang="ts">
	import { onMount } from "svelte";
	import { page } from "$app/stores";
	import { beforeNavigate, afterNavigate, goto } from "$app/navigation";
	import { MODEL_CATALOG, JUDGE_MODELS } from "$lib/config/modelCatalog";
	import { ASSUMED_TOKEN_SIZES, COST_ESTIMATE_SAFETY_FACTOR } from "$lib/config/constants";
	import {
		DEFAULT_GENERATION_PROMPT_TEMPLATE,
		buildTestPromptFromTemplate,
		buildGenerationPromptFromExpanded,
	} from "$lib/prompts/test";
	import { QUIZ_SCHEMA_JSON } from "$lib/schemas/quiz-schema";
	import {
		DEFAULT_JUDGE_PROMPT_TEMPLATE,
		JUDGE_RESPONSE_SCHEMA_JSON,
		buildJudgePromptFromTemplate,
	} from "$lib/prompts/judge";
	import {
		DEFAULT_ENRICHMENT_PROMPT_TEMPLATE,
		buildEnrichmentPromptFromTemplate,
	} from "$lib/prompts/enrichment";
	import { parseQuiz, validateQuizSchema } from "$lib/validation/quiz";
	import { parseJudgeResponse } from "$lib/validation/judge";
	import { computeModelAggregates, computeRunQualityFromJudges, getNormalizedScores } from "$lib/run-aggregates";
	import { isQuizEvalResponse } from "$lib/types/judge";
	import { saveRun, updateRun } from "$lib/db/runs";
	import { listUserModels, addUserModel, deleteUserModel } from "$lib/db/userModels";
	import type { UserModel } from "$lib/db/userModels";
	import type { ModelResult, RunPayload, SingleRun } from "$lib/types/run";
	import type { OpenRouterModelInfo } from "$lib/types/models";

	const RUN_ID_PREFIX = "run-";
	const API_KEY_STORAGE_KEY = "openrouter_api_key";

	const RESULT_COLUMNS = [
		{ id: "model", label: "Model" },
		{ id: "runs", label: "Runs" },
		{ id: "evals", label: "Evals" },
		{ id: "time", label: "Time avg (s)" },
		{ id: "cost", label: "Cost / 1k runs" },
		{ id: "consistency", label: "Consistency %" },
		{ id: "correctness", label: "Correctness" },
		{ id: "alignment", label: "Alignment" },
		{ id: "compliance", label: "Compliance" },
		{ id: "quality", label: "Quality avg" },
	] as const;

	// State
	let api_key_stored = $state(false);
	let editing_api_key = $state(false);
	let api_key_input = $state("");
	let user_added_models = $state<UserModel[]>([]);
	let show_add_model_form = $state(false);
	let add_model_id = $state("");
	let add_model_label = $state("");
	let add_model_error = $state<string | null>(null);
	let sampling_info_open = $state<string | null>(null);
	type ProgressLogLine = { text: string; isError?: boolean; type?: "generation" | "judge" };
	let progress_log_lines = $state<ProgressLogLine[]>([]);
	let show_leave_modal = $state(false);
	let pending_navigate_url = $state<string | null>(null);
	let leave_confirmed = $state(false);
	let show_openrouter_overlay = $state(false);

	let learning_objective = $state("e.g. Common Core Maths CCSS.Math.Content.3.OA.A.1");
	let request = $state("e.g. 10 question quiz covering different aspects of this learning objective");
	let use_enrichment_prompt = $state(false);
	let generation_prompt_template = $state(DEFAULT_GENERATION_PROMPT_TEMPLATE);
	let judge_prompt_template = $state(DEFAULT_JUDGE_PROMPT_TEMPLATE);
	let enrichment_prompt_template = $state(DEFAULT_ENRICHMENT_PROMPT_TEMPLATE);
	let prompts_saved = $state(false);
	let prompts_section_open = $state(false);
	let generation_schema_open = $state(false);
	let judge_schema_open = $state(false);
	let selected_test_models = $state<Set<string>>(new Set(MODEL_CATALOG.filter((m) => m.defaultChecked).map((m) => m.id)));
	let selected_judge_models = $state<Set<string>>(new Set(JUDGE_MODELS.slice(0, 3).map((m) => m.id)));
	let runs_per_model = $state(3);
	let temperature = $state(0.7);
	let vary_temperature = $state(false);
	let max_concurrency = $state(3);
	let min_spacing_ms = $state(300);
	let full_prompt = $state("");
	let model_results = $state<ModelResult[]>([]);
	let run_id = $state("");
	let started_at = $state(0);
	let cancel_requested = $state(false);
	let open_router_models = $state<Map<string, OpenRouterModelInfo>>(new Map());
	let models_loading = $state(false);
	let models_error = $state<string | null>(null);
	let key_info = $state<Record<string, unknown> | null>(null);
	let key_loading = $state(false);
	let key_error = $state<string | null>(null);
	let estimated_cost_usd = $state<number | null>(null);
	let actual_cost_usd = $state(0);
	let expanded_model_id = $state<string | null>(null);
	let details_run_index = $state(0);
	let details_question_index = $state(0);
	let details_judge_index = $state(0);
	let show_bars = $state(false);
	let show_std = $state(true);
	let bar_scale_min_user = $state(80);
	let sort_column = $state<"quality" | "time" | "consistency" | "correctness" | "alignment" | "compliance">("quality");
	let sort_desc = $state(true);
	let hidden_model_ids = $state<Set<string>>(new Set());
	let hidden_column_ids = $state<Set<string>>(new Set());
	let rows_dropdown_open = $state(false);
	let columns_dropdown_open = $state(false);

	// URL runId for viewing past run
	const runIdParam = $derived($page.url.searchParams.get("runId"));
	let viewing_run = $state<RunPayload | null>(null);

	// Derived
	const total_runs = $derived(
		model_results.length > 0 ? model_results.reduce((sum, m) => sum + m.runs.length, 0) : 0
	);
	const completed_runs = $derived(
		model_results.length > 0
			? model_results.reduce(
					(sum, m) => sum + m.runs.filter((r) => r.status === "complete" || r.status === "failed").length,
					0
				)
			: 0
	);
	/** Flattened run statuses for the progress bar, grouped by state: done (green), then active (orange), then pending (gray). */
	const run_statuses = $derived.by(() => {
		const list: Array<"complete" | "failed" | "running" | "queued"> = [];
		for (const m of model_results) {
			for (const r of m.runs) list.push(r.status);
		}
		const order = (s: string) => (s === "complete" || s === "failed" ? 0 : s === "running" ? 1 : 2);
		list.sort((a, b) => order(a) - order(b));
		return list;
	});
	const is_running = $derived(model_results.some((m) => m.runs.some((r) => r.status === "running" || r.status === "queued")));
	const can_analyse = $derived(
		api_key_stored &&
			!is_running &&
			learning_objective.trim().length > 0 &&
			request.trim().length > 0 &&
			selected_test_models.size > 0 &&
			selected_judge_models.size > 0
	);
	const sorted_results = $derived.by(() => {
		const list = [...model_results];
		list.sort((a, b) => {
			let va: number | null, vb: number | null;
			switch (sort_column) {
				case "quality":
					va = a.quality_avg;
					vb = b.quality_avg;
					break;
				case "time":
					va = a.time_avg_ms;
					vb = b.time_avg_ms;
					break;
				case "consistency":
					va = a.consistency_percent;
					vb = b.consistency_percent;
					break;
				case "correctness":
					va = a.correctness_avg;
					vb = b.correctness_avg;
					break;
				case "alignment":
					va = a.alignment_avg;
					vb = b.alignment_avg;
					break;
				case "compliance":
					va = a.compliance_avg;
					vb = b.compliance_avg;
					break;
				default:
					return 0;
			}
			if (va == null && vb == null) return 0;
			if (va == null) return sort_desc ? 1 : -1;
			if (vb == null) return sort_desc ? -1 : 1;
			return sort_desc ? vb - va : va - vb;
		});
		return list;
	});
	const visible_results = $derived(sorted_results.filter((r) => !hidden_model_ids.has(r.model_id)));
	const visible_columns = $derived(RESULT_COLUMNS.filter((c) => !hidden_column_ids.has(c.id)));
	const visible_column_count = $derived(visible_columns.length);

	function toggleRowVisibility(model_id: string) {
		const next = new Set(hidden_model_ids);
		if (next.has(model_id)) next.delete(model_id);
		else next.add(model_id);
		hidden_model_ids = next;
	}

	function toggleColumnVisibility(col_id: string) {
		const next = new Set(hidden_column_ids);
		if (next.has(col_id)) next.delete(col_id);
		else next.add(col_id);
		hidden_column_ids = next;
	}

	/** Auto scale min from data (lowest quality-related metric, rounded down to nearest 10). Used when not in bar view or as reference. */
	const bar_scale_min_auto = $derived.by(() => {
		let minVal = 100;
		for (const m of model_results) {
			const vals = [
				m.quality_avg,
				m.consistency_percent,
				m.correctness_avg,
				m.alignment_avg,
				m.compliance_avg,
			];
			for (const v of vals) {
				if (typeof v === "number" && !Number.isNaN(v)) minVal = Math.min(minVal, v);
			}
		}
		return Math.max(0, Math.floor(minVal / 10) * 10);
	});
	/** Effective scale min: user slider when showing bars (clamped 0–100), else auto. */
	const effective_bar_scale_min = $derived(
		show_bars ? Math.max(0, Math.min(100, Number(bar_scale_min_user) || 0)) : bar_scale_min_auto
	);
	/** Alias for bar fill / display (kept for any reference that used the old name). */
	const bar_scale_min = $derived(effective_bar_scale_min);

	// Estimated cost: OpenRouter pricing is per-token (USD). Formula: (input_tokens * prompt_price + output_tokens * completion_price) per call.
	function computeEstimatedCost(): number | null {
		const modelsData = open_router_models;
		if (modelsData.size === 0) return null;
		let total = 0;
		const nRuns = Number(runs_per_model) || 3;
		const total_quiz_runs = selected_test_models.size * nRuns;
		for (const modelId of selected_test_models) {
			const info = modelsData.get(modelId);
			if (info?.pricing?.prompt != null && info?.pricing?.completion != null) {
				const pin = parseFloat(String(info.pricing.prompt));
				const pout = parseFloat(String(info.pricing.completion));
				total += nRuns * (ASSUMED_TOKEN_SIZES.generation.input * pin + ASSUMED_TOKEN_SIZES.generation.output * pout);
				if (use_enrichment_prompt) {
					total += nRuns * (ASSUMED_TOKEN_SIZES.enrichment.input * pin + ASSUMED_TOKEN_SIZES.enrichment.output * pout);
				}
			}
		}
		for (const judgeId of selected_judge_models) {
			const info = modelsData.get(judgeId);
			if (info?.pricing?.prompt != null && info?.pricing?.completion != null) {
				const pin = parseFloat(String(info.pricing.prompt));
				const pout = parseFloat(String(info.pricing.completion));
				total += total_quiz_runs * (ASSUMED_TOKEN_SIZES.judge.input * pin + ASSUMED_TOKEN_SIZES.judge.output * pout);
			}
		}
		return total * COST_ESTIMATE_SAFETY_FACTOR;
	}
	$effect(() => {
		estimated_cost_usd = computeEstimatedCost();
	});

	$effect(() => {
		expanded_model_id;
		details_run_index = 0;
		details_question_index = 0;
		details_judge_index = 0;
	});

	// localStorage keys
	const LS_OBJECTIVE = "llm-eval-objective";
	const LS_REQUEST = "llm-eval-request";
	const LS_TEST_MODELS = "llm-eval-test-models";
	const LS_JUDGE_MODELS = "llm-eval-judge-models";
	const LS_SAMPLING = "llm-eval-sampling";
	const LS_PROMPTS = "llm-eval-prompts";
	const PLACEHOLDER_OBJECTIVE = "{{learningObjective}}";
	const PLACEHOLDER_REQUEST = "{{request}}";
	const PLACEHOLDER_QUIZ_SCHEMA = "{{quiz_schema}}";
	const PLACEHOLDER_JUDGE_SCHEMA = "{{judge_response_schema}}";
	const PLACEHOLDER_LEARNING_OBJECTIVE = "{{learning_objective}}";
	const PLACEHOLDER_TEACHER_REQUEST = "{{teacher_request}}";
	const PLACEHOLDER_QUIZ = "{{quiz}}";

	/** Headers to send with API requests (key is stored in sessionStorage, not in reactive state). */
	function getApiHeaders(): Record<string, string> {
		if (typeof sessionStorage === "undefined") return {};
		const k = sessionStorage.getItem(API_KEY_STORAGE_KEY);
		return k ? { Authorization: `Bearer ${k}` } : {};
	}

	function saveApiKey() {
		const key = api_key_input.trim();
		if (!key) return;
		if (typeof sessionStorage !== "undefined") {
			sessionStorage.setItem(API_KEY_STORAGE_KEY, key);
		}
		api_key_input = "";
		api_key_stored = true;
		editing_api_key = false;
		fetchModels(true);
	}

	function clearApiKey() {
		if (typeof sessionStorage !== "undefined") {
			sessionStorage.removeItem(API_KEY_STORAGE_KEY);
		}
		api_key_input = "";
		api_key_stored = false;
		editing_api_key = false;
	}

	function editApiKey() {
		editing_api_key = true;
		api_key_input = "";
	}

	function cancelEditApiKey() {
		editing_api_key = false;
		api_key_input = "";
	}

	function leaveAnyway() {
		const url = pending_navigate_url;
		leave_confirmed = true;
		show_leave_modal = false;
		pending_navigate_url = null;
		if (url) goto(url);
	}

	async function loadUserModels() {
		try {
			user_added_models = await listUserModels();
		} catch (_) {
			user_added_models = [];
		}
	}

	async function saveNewUserModel() {
		add_model_error = null;
		const id = add_model_id.trim();
		if (!id) {
			add_model_error = "Model ID is required";
			return;
		}
		const label = add_model_label.trim() || id;
		try {
			await addUserModel({ id, label });
			user_added_models = await listUserModels();
			add_model_id = "";
			add_model_label = "";
			show_add_model_form = false;
		} catch (e) {
			add_model_error = e instanceof Error ? e.message : String(e);
		}
	}

	function toggleSamplingInfo(id: string) {
		sampling_info_open = sampling_info_open === id ? null : id;
	}

	function cancelAddModel() {
		show_add_model_form = false;
		add_model_id = "";
		add_model_label = "";
		add_model_error = null;
	}

	async function removeUserModel(id: string) {
		try {
			await deleteUserModel(id);
			user_added_models = user_added_models.filter((m) => m.id !== id);
			const next = new Set(selected_test_models);
			next.delete(id);
			selected_test_models = next;
			saveToStorage();
		} catch (_) {}
	}

	function loadFromStorage() {
		if (typeof localStorage === "undefined") return;
		try {
			const o = localStorage.getItem(LS_OBJECTIVE);
			if (o != null) learning_objective = o;
			const r = localStorage.getItem(LS_REQUEST);
			if (r != null) request = r;
			const t = localStorage.getItem(LS_TEST_MODELS);
			if (t != null) {
				const arr = JSON.parse(t) as string[];
				if (Array.isArray(arr)) selected_test_models = new Set(arr);
			}
			const j = localStorage.getItem(LS_JUDGE_MODELS);
			if (j != null) {
				const arr = JSON.parse(j) as string[];
				if (Array.isArray(arr)) selected_judge_models = new Set(arr);
			}
			const s = localStorage.getItem(LS_SAMPLING);
			if (s != null) {
				const obj = JSON.parse(s) as Record<string, unknown>;
				if (obj && typeof obj.runs_per_model === "number") runs_per_model = obj.runs_per_model;
				if (obj && typeof obj.temperature === "number") temperature = obj.temperature;
				if (obj && typeof obj.vary_temperature === "boolean") vary_temperature = obj.vary_temperature;
				if (obj && typeof obj.max_concurrency === "number") max_concurrency = obj.max_concurrency;
				if (obj && typeof obj.min_spacing_ms === "number") min_spacing_ms = obj.min_spacing_ms;
				if (obj && typeof obj.use_enrichment_prompt === "boolean") use_enrichment_prompt = obj.use_enrichment_prompt;
			}
		} catch (_) {}
	}

	const PROMPTS_STORAGE_VERSION = 6;

	function loadPrompts() {
		if (typeof localStorage === "undefined") return;
		try {
			const raw = localStorage.getItem(LS_PROMPTS);
			if (raw == null) return;
			const obj = JSON.parse(raw) as Record<string, unknown>;
			// Only use saved prompts if stored with current version (judge template no longer embeds schema)
			if (obj?.version !== PROMPTS_STORAGE_VERSION) return;
			if (typeof obj.generation === "string") generation_prompt_template = obj.generation;
			if (typeof obj.judge === "string") judge_prompt_template = obj.judge;
			if (typeof obj.enrichment === "string") enrichment_prompt_template = obj.enrichment;
		} catch (_) {}
	}

	function savePrompts() {
		if (typeof localStorage === "undefined") return;
		try {
			localStorage.setItem(
				LS_PROMPTS,
				JSON.stringify({
					version: PROMPTS_STORAGE_VERSION,
					generation: generation_prompt_template,
					judge: judge_prompt_template,
					enrichment: enrichment_prompt_template,
				})
			);
			prompts_saved = true;
			setTimeout(() => (prompts_saved = false), 2000);
		} catch (_) {}
	}

	function resetPromptsToDefaults() {
		generation_prompt_template = DEFAULT_GENERATION_PROMPT_TEMPLATE;
		judge_prompt_template = DEFAULT_JUDGE_PROMPT_TEMPLATE;
		enrichment_prompt_template = DEFAULT_ENRICHMENT_PROMPT_TEMPLATE;
		if (typeof localStorage !== "undefined") {
			try {
				localStorage.removeItem(LS_PROMPTS);
			} catch (_) {}
		}
	}

	function saveToStorage() {
		if (typeof localStorage === "undefined") return;
		try {
			localStorage.setItem(LS_OBJECTIVE, learning_objective);
			localStorage.setItem(LS_REQUEST, request);
			localStorage.setItem(LS_TEST_MODELS, JSON.stringify([...selected_test_models]));
			localStorage.setItem(LS_JUDGE_MODELS, JSON.stringify([...selected_judge_models]));
			localStorage.setItem(
				LS_SAMPLING,
				JSON.stringify({
					runs_per_model,
					temperature,
					vary_temperature,
					max_concurrency,
					min_spacing_ms,
					use_enrichment_prompt,
				})
			);
		} catch (_) {}
	}

	async function fetchModels(refresh = false) {
		models_loading = true;
		models_error = null;
		try {
			const url = refresh ? "/api/models?refresh=1" : "/api/models";
			const res = await fetch(url, { headers: getApiHeaders() });
			if (res.status === 401) {
				models_error = "Enter your API key above to fetch model prices";
				return;
			}
			if (!res.ok) throw new Error(await res.text());
			const data = await res.json();
			const list = data.data ?? data;
			const map = new Map<string, OpenRouterModelInfo>();
			for (const m of list) {
				if (m?.id) map.set(m.id, m);
			}
			open_router_models = map;
		} catch (e) {
			models_error = e instanceof Error ? e.message : String(e);
		} finally {
			models_loading = false;
		}
	}

	async function fetchKeyInfo() {
		key_loading = true;
		key_error = null;
		try {
			const res = await fetch("/api/key", { headers: getApiHeaders() });
			if (res.status === 401) {
				key_error = "Enter your API key above to fetch model prices";
				return;
			}
			if (!res.ok) throw new Error(await res.text());
			key_info = await res.json();
		} catch (e) {
			key_error = e instanceof Error ? e.message : String(e);
		} finally {
			key_loading = false;
		}
	}

	function toggleTestModel(id: string) {
		const next = new Set(selected_test_models);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selected_test_models = next;
		saveToStorage();
	}

	function selectAllTestModels() {
		selected_test_models = new Set(MODEL_CATALOG.map((m) => m.id));
		saveToStorage();
	}

	function selectNoneTestModels() {
		selected_test_models = new Set();
		saveToStorage();
	}

	function selectFirst10TestModels() {
		selected_test_models = new Set(MODEL_CATALOG.slice(0, 10).map((m) => m.id));
		saveToStorage();
	}

	function toggleJudgeModel(id: string) {
		const next = new Set(selected_judge_models);
		if (next.has(id)) next.delete(id);
		else if (next.size < 3) next.add(id);
		else {
			next.delete(id);
			next.add(id);
		}
		selected_judge_models = next;
		saveToStorage();
	}

	const TEMP_SPREAD = [0.4, 0.7, 1.0];

	async function runAnalysis() {
		if (!can_analyse) return;
		saveToStorage();
		cancel_requested = false;
		run_id = RUN_ID_PREFIX + Date.now();
		started_at = Date.now();
		full_prompt = buildTestPromptFromTemplate(
			generation_prompt_template,
			learning_objective.trim(),
			request.trim()
		);
		actual_cost_usd = 0;
		progress_log_lines = [];

		const nRuns = Number(runs_per_model) || 3;
		const nConc = Number(max_concurrency) || 3;
		const nMinSpacing = Number(min_spacing_ms) || 0;

		// Build interleaved job list: (model_id, run_index, temperature)
		const jobs: { model_id: string; run_index: number; temperature: number }[] = [];
		const testModelIds = [...selected_test_models];
		const judgeIds = [...selected_judge_models];
		for (let r = 0; r < nRuns; r++) {
			for (const modelId of testModelIds) {
				const temp = vary_temperature ? TEMP_SPREAD[r % TEMP_SPREAD.length] : temperature;
				jobs.push({ model_id: modelId, run_index: r, temperature: temp });
			}
		}

		// Initialize model_results with empty runs
		const catalogById = new Map(MODEL_CATALOG.map((m) => [m.id, m]));
		const userLabels = new Map(user_added_models.map((m) => [m.id, m.label]));
		const initialResults: ModelResult[] = testModelIds.map((modelId) => {
			const label = catalogById.get(modelId)?.label ?? userLabels.get(modelId) ?? modelId;
			const runs: SingleRun[] = [];
			for (let r = 0; r < nRuns; r++) {
				runs.push({
					run_index: r,
					status: "queued",
					throttle_events: 0,
					consistency_pass: false,
					quiz_raw_text: "",
					quiz_json: null,
					schema_errors: [],
					judge_results: [],
				});
			}
			return computeModelAggregates(modelId, label, runs);
		});
		model_results = initialResults;

		const resultsByModel = new Map<string, ModelResult>();
		for (const m of model_results) resultsByModel.set(m.model_id, m);

		let currentRunDbId: number | null = null;
		try {
			const initialPayload: RunPayload = {
				run_id,
				started_at,
				learning_objective: learning_objective.trim(),
				request: request.trim(),
				full_prompt,
				use_enrichment_prompt: use_enrichment_prompt || undefined,
				runs_per_model,
				temperature,
				vary_temperature,
				max_concurrency,
				min_spacing_ms,
				selected_test_models: [...selected_test_models],
				selected_judge_models: [...selected_judge_models],
				model_results: initialResults,
				estimated_cost_usd: estimated_cost_usd ?? undefined,
			};
			currentRunDbId = await saveRun(initialPayload);
		} catch (e) {
			console.error("Failed to save initial run to IndexedDB:", e);
		}

		const PERSIST_THROTTLE_MS = 3000;
		let lastPersistTime = 0;

		function persistRunPayload() {
			if (currentRunDbId == null) return;
			const now = Date.now();
			if (now - lastPersistTime < PERSIST_THROTTLE_MS) return;
			lastPersistTime = now;
			const payload: RunPayload = {
				run_id,
				started_at,
				learning_objective: learning_objective.trim(),
				request: request.trim(),
				full_prompt,
				use_enrichment_prompt: use_enrichment_prompt || undefined,
				runs_per_model,
				temperature,
				vary_temperature,
				max_concurrency,
				min_spacing_ms,
				selected_test_models: [...selected_test_models],
				selected_judge_models: [...selected_judge_models],
				model_results,
				estimated_cost_usd: estimated_cost_usd ?? undefined,
				actual_cost_usd: actual_cost_usd > 0 ? actual_cost_usd : undefined,
			};
			updateRun(currentRunDbId, payload).catch((e) =>
				console.error("Failed to update run in IndexedDB:", e)
			);
		}

		let lastRequestTime = 0;
		let jobIndex = 0;
		const minSpacing = nMinSpacing;
		const concurrency = nConc;

		function appendProgress(line: string, isError?: boolean, type?: "generation" | "judge") {
			progress_log_lines = [...progress_log_lines, { text: line, isError, type }];
		}

		async function processOneJob(): Promise<void> {
			const idx = jobIndex++;
			if (idx >= jobs.length || cancel_requested) return;
			const job = jobs[idx];
			const modelResult = resultsByModel.get(job.model_id);
			if (!modelResult) return;
			const run = modelResult.runs[job.run_index];
			if (!run) return;

			run.status = "running";
			model_results = [...model_results];

			const now = Date.now();
			const wait = Math.max(0, minSpacing - (now - lastRequestTime));
			if (wait > 0) await new Promise((r) => setTimeout(r, wait));
			lastRequestTime = Date.now();

			appendProgress(`Quiz generation ${modelResult.model_label}, run ${job.run_index + 1}...`, false, "generation");

			try {
				let testData: {
					raw_text?: string;
					wall_time_ms?: number;
					service_time_ms?: number;
					retry_count?: number;
					backoff_ms_total?: number;
					throttle_events?: number;
					usage?: { prompt_tokens: number; completion_tokens: number };
					cost?: number;
					error?: string;
				};

				if (use_enrichment_prompt) {
					const enrichmentPrompt = buildEnrichmentPromptFromTemplate(
						enrichment_prompt_template,
						learning_objective.trim(),
						request.trim()
					);
					const enrichRes = await fetch("/api/test", {
						method: "POST",
						headers: { "Content-Type": "application/json", ...getApiHeaders() },
						body: JSON.stringify({
							model_id: job.model_id,
							full_prompt: enrichmentPrompt,
							temperature: job.temperature,
						}),
					});
					const enrichData = await enrichRes.json();
					if (!enrichRes.ok) {
						const errMsg = enrichData.error ?? enrichRes.statusText;
						console.error("[enrichment error]", { model: job.model_id, run_index: job.run_index, status: enrichRes.status, response: enrichData });
						appendProgress(`...Enrichment ${modelResult.model_label}, run ${job.run_index + 1} failed: ${errMsg}`, true, "generation");
						throw new Error(errMsg);
					}
					run.enrichment_generated_prompt = enrichData.raw_text ?? "";
					const expandedPrompt = buildGenerationPromptFromExpanded(enrichData.raw_text ?? "");
					const genRes = await fetch("/api/test", {
						method: "POST",
						headers: { "Content-Type": "application/json", ...getApiHeaders() },
						body: JSON.stringify({
							model_id: job.model_id,
							full_prompt: expandedPrompt,
							temperature: job.temperature,
						}),
					});
					testData = await genRes.json();
					if (!genRes.ok) {
						const errMsg = testData.error ?? genRes.statusText;
						console.error("[test error]", { model: job.model_id, run_index: job.run_index, status: genRes.status, response: testData });
						appendProgress(`...Quiz generation ${modelResult.model_label}, run ${job.run_index + 1} failed: ${errMsg}`, true, "generation");
						throw new Error(errMsg);
					}
					// Sum enrichment + generation metrics (time = sum of call times, not elapsed)
					run.wall_time_ms = (enrichData.wall_time_ms ?? 0) + (testData.wall_time_ms ?? 0);
					run.service_time_ms = (enrichData.service_time_ms ?? 0) + (testData.service_time_ms ?? 0);
					run.retry_count = (enrichData.retry_count ?? 0) + (testData.retry_count ?? 0);
					run.backoff_ms_total = (enrichData.backoff_ms_total ?? 0) + (testData.backoff_ms_total ?? 0);
					run.throttle_events = (enrichData.throttle_events ?? 0) + (testData.throttle_events ?? 0);
					run.usage = {
						prompt_tokens: (enrichData.usage?.prompt_tokens ?? 0) + (testData.usage?.prompt_tokens ?? 0),
						completion_tokens: (enrichData.usage?.completion_tokens ?? 0) + (testData.usage?.completion_tokens ?? 0),
					};
					const combinedCost = (typeof enrichData.cost === "number" ? enrichData.cost : 0) + (typeof testData.cost === "number" ? testData.cost : 0);
					if (combinedCost > 0) {
						run.cost = combinedCost;
						actual_cost_usd += combinedCost;
					}
				} else {
					const testRes = await fetch("/api/test", {
						method: "POST",
						headers: { "Content-Type": "application/json", ...getApiHeaders() },
						body: JSON.stringify({
							model_id: job.model_id,
							full_prompt,
							temperature: job.temperature,
						}),
					});
					testData = await testRes.json();
					if (!testRes.ok) {
						const errMsg = testData.error ?? testRes.statusText;
						console.error("[test error]", { model: job.model_id, run_index: job.run_index, status: testRes.status, response: testData });
						appendProgress(`...Quiz generation ${modelResult.model_label}, run ${job.run_index + 1} failed: ${errMsg}`, true, "generation");
						throw new Error(errMsg);
					}
					run.wall_time_ms = testData.wall_time_ms;
					run.service_time_ms = testData.service_time_ms;
					run.retry_count = testData.retry_count;
					run.backoff_ms_total = testData.backoff_ms_total;
					run.throttle_events = testData.throttle_events ?? 0;
					run.usage = testData.usage;
					if (typeof testData.cost === "number") {
						run.cost = testData.cost;
						actual_cost_usd += testData.cost;
					}
				}

				run.quiz_raw_text = testData.raw_text ?? "";
				const genSec = (run.wall_time_ms ?? 0) / 1000;
				appendProgress(`...Quiz generation ${modelResult.model_label}, run ${job.run_index + 1} complete (${genSec.toFixed(1)} s)`, false, "generation");

				const parsed = parseQuiz(run.quiz_raw_text);
				if (parsed.parseError) {
					console.error("[quiz parse error]", { model: job.model_id, run_index: job.run_index, parseError: parsed.parseError, raw_text: run.quiz_raw_text });
					run.parse_error = parsed.parseError;
					run.consistency_pass = false;
					appendProgress(`...Quiz parse error (${modelResult.model_label}, run ${job.run_index + 1}): ${parsed.parseError}`, true, "generation");
				} else {
					const validated = validateQuizSchema(parsed.data);
					run.quiz_json = parsed.data ?? null;
					run.schema_errors = validated.errors;
					run.consistency_pass = validated.valid;
				}

				// Judge calls (only if valid quiz)
				if (run.quiz_json) {
					const quizJsonStr = JSON.stringify(run.quiz_json);
					for (const judgeId of judgeIds) {
						if (cancel_requested) break;
						const judgeLabel = catalogById.get(judgeId)?.label ?? judgeId;
						appendProgress(`Judge evaluation (${judgeLabel}) for ${modelResult.model_label}, run ${job.run_index + 1}...`, false, "judge");
						const judgePrompt = buildJudgePromptFromTemplate(
							judge_prompt_template,
							learning_objective.trim(),
							request.trim(),
							quizJsonStr
						);
						const jRes = await fetch("/api/judge", {
							method: "POST",
							headers: { "Content-Type": "application/json", ...getApiHeaders() },
							body: JSON.stringify({ judge_model_id: judgeId, judge_prompt: judgePrompt }),
						});
						const jData = await jRes.json();
						const judgeItem = {
							judge_model_id: judgeId,
							judge_label: judgeLabel,
							raw_text: jData.raw_text ?? "",
							usage: jData.usage,
							cost: jData.cost,
							service_time_ms: jData.service_time_ms,
							wall_time_ms: jData.wall_time_ms,
						} as SingleRun["judge_results"][0];
						if (!jRes.ok) {
							const errMsg = jData.error ?? jRes.statusText;
							console.error("[judge error]", { judge: judgeLabel, status: jRes.status, response: jData });
							judgeItem.parse_error = errMsg;
							appendProgress(`...Judge evaluation (${judgeLabel}) for ${modelResult.model_label}, run ${job.run_index + 1} failed: ${errMsg}`, true, "judge");
						}
						if (typeof jData.cost === "number") actual_cost_usd += jData.cost;
						const jParsed = parseJudgeResponse(judgeItem.raw_text);
						if (jParsed.parseError) {
							console.error("[judge parse error]", { judge: judgeLabel, parseError: jParsed.parseError, raw_text: judgeItem.raw_text, ...(judgeItem.raw_text === "" ? { full_response: jData } : {}) });
							judgeItem.parse_error = judgeItem.parse_error ? `${judgeItem.parse_error}; parse: ${jParsed.parseError}` : jParsed.parseError;
							appendProgress(`...Judge parse error (${judgeLabel}) for ${modelResult.model_label}, run ${job.run_index + 1}: ${jParsed.parseError}`, true, "judge");
						} else if (!judgeItem.parse_error) judgeItem.parsed = jParsed.data;
						run.judge_results = [...run.judge_results, judgeItem];
						const quality = computeRunQualityFromJudges(run.judge_results);
						if (quality) {
							run.run_quality_avg = quality.run_quality_avg;
							run.run_correctness_avg = quality.run_correctness_avg;
							run.run_alignment_avg = quality.run_alignment_avg;
							run.run_compliance_avg = quality.run_compliance_avg;
						}
						const updated = computeModelAggregates(modelResult.model_id, modelResult.model_label, modelResult.runs);
						resultsByModel.set(job.model_id, updated);
						model_results = Array.from(resultsByModel.values());
						const judgeSec = (jData.wall_time_ms ?? 0) / 1000;
						if (jRes.ok && !jParsed.parseError) appendProgress(`...Judge evaluation (${judgeLabel}) for ${modelResult.model_label}, run ${job.run_index + 1} complete (${judgeSec.toFixed(1)} s)`, false, "judge");
					}
				}

				run.status = "complete";

				// Per-run timing and token comparison (gen vs judges)
				const gen_time_ms = run.wall_time_ms ?? 0;
				const judge_time_ms_total = run.judge_results.reduce((s, j) => s + (j.wall_time_ms ?? 0), 0);
				const test_tokens = (run.usage?.prompt_tokens ?? 0) + (run.usage?.completion_tokens ?? 0);
				const judge_completion_tokens = run.judge_results.reduce((s, j) => s + (j.usage?.completion_tokens ?? 0), 0);
				console.log("[run]", {
					model: modelResult.model_label,
					run_index: run.run_index + 1,
					gen_time_ms,
					judge_time_ms_total,
					gen_vs_judge: judge_time_ms_total > 0 ? (gen_time_ms / judge_time_ms_total).toFixed(2) : "—",
					test_tokens_prompt: run.usage?.prompt_tokens ?? 0,
					test_tokens_completion: run.usage?.completion_tokens ?? 0,
					test_tokens_total: test_tokens,
					judge_completion_tokens,
				});
			} catch (e) {
				run.status = "failed";
				run.error = e instanceof Error ? e.message : String(e);
				appendProgress(`...Quiz generation ${modelResult.model_label}, run ${job.run_index + 1} failed: ${run.error}`, true, "generation");
				console.error("[run failed]", { model: modelResult.model_label, run_index: run.run_index, error: run.error, err: e });
			}

			// Recompute aggregates for this model
			const updated = computeModelAggregates(modelResult.model_id, modelResult.model_label, modelResult.runs);
			resultsByModel.set(job.model_id, updated);
			model_results = Array.from(resultsByModel.values());

			// Persist partial run so we keep data if analysis is ended early
			persistRunPayload();

			// Process next job if any
			if (jobIndex < jobs.length && !cancel_requested) {
				await processOneJob();
			}
		}

		// Start worker pool (concurrency workers)
		const workers = Array.from(
			{ length: Math.min(concurrency, jobs.length) },
			() => processOneJob()
		);
		await Promise.all(workers);

		// Persist final state to IndexedDB (same record as incremental updates)
		const payload: RunPayload = {
			run_id,
			started_at,
			learning_objective: learning_objective.trim(),
			request: request.trim(),
			full_prompt,
			use_enrichment_prompt: use_enrichment_prompt || undefined,
			runs_per_model,
			temperature,
			vary_temperature,
			max_concurrency,
			min_spacing_ms,
			selected_test_models: [...selected_test_models],
			selected_judge_models: [...selected_judge_models],
			model_results,
			estimated_cost_usd: estimated_cost_usd ?? undefined,
			actual_cost_usd: actual_cost_usd > 0 ? actual_cost_usd : undefined,
		};
		try {
			if (currentRunDbId != null) {
				await updateRun(currentRunDbId, payload);
			} else {
				await saveRun(payload);
			}
		} catch (e) {
			console.error("Failed to save run to IndexedDB:", e);
		}
	}

	function cancelRun() {
		cancel_requested = true;
	}

	function clearResults() {
		model_results = [];
		run_id = "";
		started_at = 0;
		actual_cost_usd = 0;
		viewing_run = null;
		if (typeof window !== "undefined") window.history.replaceState({}, "", "/");
	}

	function exportJson() {
		const payload = viewing_run ?? {
			run_id,
			started_at,
			learning_objective,
			request,
			full_prompt,
			use_enrichment_prompt: use_enrichment_prompt || undefined,
			runs_per_model,
			temperature,
			vary_temperature,
			max_concurrency,
			min_spacing_ms,
			selected_test_models: [...selected_test_models],
			selected_judge_models: [...selected_judge_models],
			model_results,
			estimated_cost_usd,
			actual_cost_usd,
		};
		const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = `llm-eval-${run_id || "export"}.json`;
		a.click();
		URL.revokeObjectURL(a.href);
	}

	$effect(() => {
		if (!is_running || typeof window === "undefined") return;
		const handler = (e: BeforeUnloadEvent) => {
			e.preventDefault();
			e.returnValue = "";
		};
		window.addEventListener("beforeunload", handler);
		return () => window.removeEventListener("beforeunload", handler);
	});

	$effect(() => {
		if (!show_openrouter_overlay || typeof window === "undefined") return;
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") show_openrouter_overlay = false;
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	});

	onMount(() => {
		api_key_stored = typeof sessionStorage !== "undefined" && !!sessionStorage.getItem(API_KEY_STORAGE_KEY);
		loadFromStorage();
		loadPrompts();
		loadUserModels();
		if (api_key_stored) fetchModels();

		beforeNavigate(({ to, cancel }) => {
			if (leave_confirmed) return;
			if (is_running && to?.url) {
				cancel();
				const u = to.url;
				pending_navigate_url = u.pathname + u.search + (u.hash || "");
				show_leave_modal = true;
			}
		});
		afterNavigate(() => {
			leave_confirmed = false;
		});
	});

	// Load past run from URL
	$effect(() => {
		const id = runIdParam;
		if (!id) {
			viewing_run = null;
			return;
		}
		const numId = parseInt(id, 10);
		if (Number.isNaN(numId)) return;
		import("$lib/db/runs").then(({ getRun }) => {
			getRun(numId).then((stored) => {
				if (runIdParam !== id || !stored) return;
				viewing_run = stored;
				model_results = stored.model_results ?? [];
				run_id = stored.run_id ?? "";
				started_at = stored.started_at ?? 0;
				learning_objective = stored.learning_objective ?? "";
				request = stored.request ?? "";
				use_enrichment_prompt = stored.use_enrichment_prompt ?? false;
				actual_cost_usd = stored.actual_cost_usd ?? 0;
			});
		});
	});

	// Debounced save to localStorage
	$effect(() => {
		learning_objective;
		request;
		use_enrichment_prompt;
		selected_test_models;
		selected_judge_models;
		runs_per_model;
		temperature;
		vary_temperature;
		max_concurrency;
		min_spacing_ms;
		const t = setTimeout(saveToStorage, 500);
		return () => clearTimeout(t);
	});

	function formatCost(c: number | null | undefined): string {
		if (c == null) return "—";
		if (c < 0.01) return `$${c.toFixed(4)}`;
		return `$${c.toFixed(2)}`;
	}
		function formatTimeSeconds(ms: number | null | undefined): string {
			if (ms == null || typeof ms !== "number") return "—";
			return (ms / 1000).toFixed(1) + " s";
		}
		function barFillPct(value: number | null | undefined): number {
			if (value == null || typeof value !== "number" || Number.isNaN(value)) return 0;
			const range = 100 - effective_bar_scale_min;
			if (range <= 0) return 100;
			return Math.max(0, Math.min(100, ((value - effective_bar_scale_min) / range) * 100));
		}

	function formatContextLen(n: number | undefined): string {
		if (n == null) return "—";
		if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
		return String(n);
	}
</script>

<svelte:head>
	<title>LLM Quiz Generation Evaluator</title>
</svelte:head>

<div class="page">
	{#if viewing_run}
		<div class="banner" role="status">
			<span class="banner-text">Viewing past run.</span>
			<a href="/" class="banner-link">Start new run</a>
			<span class="banner-sep">·</span>
			<a href="/runs" class="banner-link">Change run</a>
		</div>
	{/if}

	<header class="page-header">
		<h1 class="page-title">LLM Quiz Generation Evaluator</h1>
		<p class="page-subtitle">Configure learning objectives, models, and sampling—then run evaluations and compare results.</p>
		<p class="page-links">
			<a href="/learn-more">Learn more</a>
			<span class="page-links-sep">·</span>
			<a href="/faq">FAQ</a>
		</p>
	</header>

	<section class="card api-key-card">
		<div class="card-title-row">
			<h2 class="card-title">OpenRouter API key</h2>
			<button type="button" class="whats-this-link" onclick={() => (show_openrouter_overlay = true)}>What's this?</button>
		</div>
		<p class="form-hint api-key-hint">Your key is stored only in this browser (session) and sent to our server with each request. We never log or store it.</p>
		{#if api_key_stored && !editing_api_key}
			<div class="api-key-saved">
				<span class="api-key-badge">Key saved</span>
				<div class="api-key-actions">
					<button type="button" class="btn btn-ghost btn-sm" onclick={editApiKey}>Edit</button>
					<button type="button" class="btn btn-ghost btn-sm btn-danger" onclick={clearApiKey}>Delete</button>
				</div>
			</div>
		{:else}
			<form class="api-key-input-row" onsubmit={(e) => { e.preventDefault(); saveApiKey(); }}>
				<input
					type="password"
					class="input api-key-input"
					placeholder={editing_api_key ? "Enter new key to replace" : "sk-or-v1-..."}
					bind:value={api_key_input}
					autocomplete="off"
				/>
				<button type="submit" class="btn btn-primary" disabled={!api_key_input.trim()}>
					Save key
				</button>
				{#if editing_api_key}
					<button type="button" class="btn btn-ghost" onclick={cancelEditApiKey}>Cancel</button>
				{/if}
			</form>
		{/if}
	</section>

	<section class="card inputs-card">
		<h2 class="card-title">Inputs</h2>
		<div class="form-group">
			<label class="form-label" for="learning-objective">Learning objective</label>
			<textarea id="learning-objective" class="input input-textarea" bind:value={learning_objective} rows="3" placeholder="e.g. Common Core Maths CCSS.Math.Content.3.OA.A.1" disabled={!!viewing_run}></textarea>
		</div>
		<div class="form-group">
			<label class="form-label" for="request">Request</label>
			<textarea id="request" class="input input-textarea" bind:value={request} rows="2" placeholder="e.g. 10 question quiz covering different aspects of this learning objective" disabled={!!viewing_run}></textarea>
		</div>
		<div class="form-group form-group-check">
			<label class="form-label-inline" for="use-enrichment">
				<input id="use-enrichment" type="checkbox" class="input-checkbox" bind:checked={use_enrichment_prompt} disabled={!!viewing_run} />
				Use enrichment prompt
			</label>
		</div>
	</section>

	<section class="card prompts-card">
		<button
			type="button"
			class="prompts-card-header"
			onclick={() => (prompts_section_open = !prompts_section_open)}
			aria-expanded={prompts_section_open}
			aria-controls="prompts-card-content"
			id="prompts-card-toggle"
		>
			<span class="prompts-card-chevron" class:prompts-card-chevron-open={prompts_section_open} aria-hidden="true">▶</span>
			<h2 class="card-title prompts-card-title">Prompts</h2>
			<p class="form-hint prompts-hint-inline">Templates used for quiz generation and judge evaluation.</p>
		</button>
		<div id="prompts-card-content" class="prompts-card-content" class:prompts-card-content-open={prompts_section_open} role="region" aria-labelledby="prompts-card-toggle">
		<div class="form-group">
			<label class="form-label" for="generation-prompt">Generation prompt template</label>
			<p class="form-hint form-hint-inline">Placeholders: <code>{PLACEHOLDER_OBJECTIVE}</code>, <code>{PLACEHOLDER_REQUEST}</code>, <code>{PLACEHOLDER_QUIZ_SCHEMA}</code> (replaced with the schema below when we build the prompt).</p>
			<textarea
				id="generation-prompt"
				class="input input-textarea prompts-textarea"
				bind:value={generation_prompt_template}
				rows="6"
				placeholder="Generation prompt template…"
				disabled={!!viewing_run}
			></textarea>
			<div class="prompts-schema-block" role="region" aria-label="Quiz JSON schema appended to generation prompt">
				<button
					type="button"
					class="prompts-schema-toggle"
					onclick={() => (generation_schema_open = !generation_schema_open)}
					aria-expanded={generation_schema_open}
					aria-controls="generation-schema-content"
				>
					<span class="prompts-schema-chevron" class:prompts-schema-chevron-open={generation_schema_open} aria-hidden="true">▶</span>
					<span class="prompts-schema-label">Content for <code>{PLACEHOLDER_QUIZ_SCHEMA}</code></span>
				</button>
				<div id="generation-schema-content" class="prompts-schema-content" class:prompts-schema-content-open={generation_schema_open}>
					<pre class="prompts-schema-pre">{QUIZ_SCHEMA_JSON}</pre>
				</div>
			</div>
		</div>
		<div class="form-group">
			<label class="form-label" for="enrichment-prompt">Enrichment prompt template</label>
			<p class="form-hint form-hint-inline">Transforms a simple teacher request into a detailed "Expanded Prompt" for quiz generation. Placeholders: <code>{PLACEHOLDER_LEARNING_OBJECTIVE}</code>, <code>{PLACEHOLDER_TEACHER_REQUEST}</code>.</p>
			<textarea
				id="enrichment-prompt"
				class="input input-textarea prompts-textarea"
				bind:value={enrichment_prompt_template}
				rows="14"
				placeholder="Enrichment prompt template…"
				disabled={!!viewing_run}
			></textarea>
		</div>
		<div class="form-group">
			<label class="form-label" for="judge-prompt">Judge prompt template</label>
			<p class="form-hint form-hint-inline">Placeholders: <code>{PLACEHOLDER_JUDGE_SCHEMA}</code>, <code>{PLACEHOLDER_LEARNING_OBJECTIVE}</code>, <code>{PLACEHOLDER_TEACHER_REQUEST}</code>, <code>{PLACEHOLDER_QUIZ}</code> (all replaced when we build the prompt).</p>
			<textarea
				id="judge-prompt"
				class="input input-textarea prompts-textarea"
				bind:value={judge_prompt_template}
				rows="12"
				placeholder="Judge prompt template…"
				disabled={!!viewing_run}
			></textarea>
			<div class="prompts-schema-block" role="region" aria-label="Judge response JSON schema expected output">
				<button
					type="button"
					class="prompts-schema-toggle"
					onclick={() => (judge_schema_open = !judge_schema_open)}
					aria-expanded={judge_schema_open}
					aria-controls="judge-schema-content"
				>
					<span class="prompts-schema-chevron" class:prompts-schema-chevron-open={judge_schema_open} aria-hidden="true">▶</span>
					<span class="prompts-schema-label">Content for <code>{PLACEHOLDER_JUDGE_SCHEMA}</code></span>
				</button>
				<div id="judge-schema-content" class="prompts-schema-content" class:prompts-schema-content-open={judge_schema_open}>
					<pre class="prompts-schema-pre">{JUDGE_RESPONSE_SCHEMA_JSON}</pre>
				</div>
			</div>
		</div>
		<div class="prompts-actions">
			<button type="button" class="btn btn-primary" onclick={savePrompts} disabled={!!viewing_run}>
				{prompts_saved ? "Saved" : "Save prompts"}
			</button>
			<button type="button" class="btn btn-ghost" onclick={resetPromptsToDefaults} disabled={!!viewing_run}>
				Reset to defaults
			</button>
		</div>
		</div>
	</section>

	<section class="card model-card">
		<div class="card-header">
			<h2 class="card-title">Test models</h2>
			<div class="card-actions">
				<button type="button" class="btn btn-ghost btn-sm" onclick={selectAllTestModels} disabled={!!viewing_run} title="Select all test models">All</button>
				<button type="button" class="btn btn-ghost btn-sm" onclick={selectFirst10TestModels} disabled={!!viewing_run} title="Select first 10 test models">First 10</button>
				<button type="button" class="btn btn-ghost btn-sm" onclick={selectNoneTestModels} disabled={!!viewing_run} title="Deselect all test models">None</button>
				<button type="button" class="btn btn-ghost btn-sm" onclick={() => fetchModels(true)} disabled={models_loading}>
					{models_loading ? 'Loading…' : 'Refresh'}
				</button>
			</div>
		</div>
		{#if models_error}<p class="form-error">{models_error}</p>{/if}
		<div class="model-grid">
			{#each MODEL_CATALOG as model}
				{@const info = open_router_models.get(model.id)}
				{@const available = !!info}
				<label class="model-row" class:unavailable={!available} for="test-model-{model.id}">
					<input id="test-model-{model.id}" type="checkbox" class="input-checkbox" checked={selected_test_models.has(model.id)} onchange={() => toggleTestModel(model.id)} disabled={!!viewing_run} />
					<span class="model-label">{model.label}</span>
					<span class="model-meta">{available ? "✓" : "—"} · {info?.pricing ? formatCost(parseFloat(String(info.pricing.prompt)) * 1e6) + "/1M in" : "—"} · {formatContextLen(info?.context_length)}</span>
				</label>
			{/each}
		</div>

		{#if user_added_models.length > 0}
			<h3 class="user-models-heading">Your additional models</h3>
			<div class="model-grid">
				{#each user_added_models as model}
					{@const info = open_router_models.get(model.id)}
					{@const available = !!info}
					<div class="model-row model-row-with-delete" class:unavailable={!available}>
						<label class="model-row-inner" for="test-model-user-{model.id}">
							<input id="test-model-user-{model.id}" type="checkbox" class="input-checkbox" checked={selected_test_models.has(model.id)} onchange={() => toggleTestModel(model.id)} disabled={!!viewing_run} />
							<span class="model-label">{model.label}</span>
							<span class="model-meta">{available ? "✓" : "—"} · {info?.pricing ? formatCost(parseFloat(String(info.pricing.prompt)) * 1e6) + "/1M in" : "—"} · {formatContextLen(info?.context_length)}</span>
						</label>
						<button type="button" class="btn btn-ghost btn-sm btn-danger" onclick={() => removeUserModel(model.id)} disabled={!!viewing_run} title="Remove from your list">Remove</button>
					</div>
				{/each}
			</div>
		{/if}

		<div class="add-model-section">
			{#if show_add_model_form}
				<div class="add-model-form">
					<div class="form-group">
						<label class="form-label" for="add-model-id">OpenRouter model ID</label>
						<input id="add-model-id" type="text" class="input" placeholder="e.g. openai/gpt-4o" bind:value={add_model_id} />
					</div>
					<div class="form-group">
						<label class="form-label" for="add-model-label">Display label (optional)</label>
						<input id="add-model-label" type="text" class="input" placeholder="e.g. My GPT-4o" bind:value={add_model_label} />
					</div>
					{#if add_model_error}<p class="form-error">{add_model_error}</p>{/if}
					<div class="add-model-buttons">
						<button type="button" class="btn btn-primary" onclick={saveNewUserModel} disabled={!add_model_id.trim()}>Add</button>
						<button type="button" class="btn btn-ghost" onclick={cancelAddModel}>Cancel</button>
					</div>
				</div>
			{:else}
				<button type="button" class="btn btn-ghost btn-sm" onclick={() => { show_add_model_form = true; add_model_error = null; }} disabled={!!viewing_run}>
					Add model
				</button>
			{/if}
		</div>
	</section>

	<section class="card judge-card">
		<h2 class="card-title">Judge models <span class="card-badge">max 3</span></h2>
		<div class="model-grid">
			{#each JUDGE_MODELS as model}
				<label class="model-row" for="judge-model-{model.id}">
					<input id="judge-model-{model.id}" type="checkbox" class="input-checkbox" checked={selected_judge_models.has(model.id)} onchange={() => toggleJudgeModel(model.id)} disabled={!!viewing_run || (selected_judge_models.size >= 3 && !selected_judge_models.has(model.id))} />
					<span class="model-label">{model.label}</span>
				</label>
			{/each}
		</div>
	</section>

	<section class="card sampling-card">
		<h2 class="card-title">Sampling</h2>
		<div class="sampling-grid">
			<div class="form-group">
				<div class="form-label-row">
					<label class="form-label" for="runs-per-model">Runs per model</label>
					<span class="info-trigger-wrap">
						<button type="button" class="info-btn" onclick={() => toggleSamplingInfo('runs-per-model')} aria-label="What does Runs per model mean?" aria-expanded={sampling_info_open === 'runs-per-model'}>?</button>
						{#if sampling_info_open === 'runs-per-model'}
							<div class="info-popover">How many quiz-generation runs to perform for each selected test model. More runs give a better estimate of consistency and variation.</div>
						{/if}
					</span>
				</div>
				<select id="runs-per-model" class="input input-select" bind:value={runs_per_model} disabled={!!viewing_run}>
					{#each [1, 2, 3, 4, 5] as n}<option value={n}>{n}</option>{/each}
				</select>
			</div>
			<div class="form-group">
				<div class="form-label-row">
					<label class="form-label" for="temperature">Temperature <span class="form-value">{temperature}</span></label>
					<span class="info-trigger-wrap">
						<button type="button" class="info-btn" onclick={() => toggleSamplingInfo('temperature')} aria-label="What does Temperature mean?" aria-expanded={sampling_info_open === 'temperature'}>?</button>
						{#if sampling_info_open === 'temperature'}
							<div class="info-popover">Controls randomness in model output. Lower (e.g. 0.3) is more deterministic; higher (e.g. 1) produces more varied responses.</div>
						{/if}
					</span>
				</div>
				<input id="temperature" type="range" class="input-range" min="0" max="2" step="0.1" bind:value={temperature} disabled={!!viewing_run} />
			</div>
			<div class="form-group form-group-check">
				<input type="checkbox" class="input-checkbox" id="vary-temp" bind:checked={vary_temperature} disabled={!!viewing_run} />
				<label for="vary-temp" class="form-label-inline">Vary per run</label>
				<span class="info-trigger-wrap">
					<button type="button" class="info-btn" onclick={() => toggleSamplingInfo('vary-per-run')} aria-label="What does Vary per run mean?" aria-expanded={sampling_info_open === 'vary-per-run'}>?</button>
					{#if sampling_info_open === 'vary-per-run'}
						<div class="info-popover">Use different temperatures (0.4, 0.7, 1.0) across runs to sample a range of model behaviors instead of the same temperature every time.</div>
					{/if}
				</span>
			</div>
			<div class="form-group">
				<div class="form-label-row">
					<label class="form-label" for="max-concurrency">Max concurrency</label>
					<span class="info-trigger-wrap">
						<button type="button" class="info-btn" onclick={() => toggleSamplingInfo('max-concurrency')} aria-label="What does Max concurrency mean?" aria-expanded={sampling_info_open === 'max-concurrency'}>?</button>
						{#if sampling_info_open === 'max-concurrency'}
							<div class="info-popover">Maximum number of requests (quiz generation or judging) to run in parallel. Higher values finish faster but may hit API rate limits.</div>
						{/if}
					</span>
				</div>
				<select id="max-concurrency" class="input input-select" bind:value={max_concurrency} disabled={!!viewing_run}>
					{#each [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as n}<option value={n}>{n}</option>{/each}
				</select>
			</div>
			<div class="form-group">
				<div class="form-label-row">
					<label class="form-label" for="min-spacing">Min spacing (ms)</label>
					<span class="info-trigger-wrap">
						<button type="button" class="info-btn" onclick={() => toggleSamplingInfo('min-spacing')} aria-label="What does Min spacing mean?" aria-expanded={sampling_info_open === 'min-spacing'}>?</button>
						{#if sampling_info_open === 'min-spacing'}
							<div class="info-popover">Minimum milliseconds to wait between starting each request. Helps avoid rate limiting when concurrency is high.</div>
						{/if}
					</span>
				</div>
				<input id="min-spacing" type="number" class="input input-number" min="0" max="2000" step="100" bind:value={min_spacing_ms} disabled={!!viewing_run} />
			</div>
		</div>
	</section>

	<section class="card run-card">
		<h2 class="card-title">Run</h2>
		{#if !viewing_run}
			<div class="run-actions">
				<button type="button" class="btn btn-primary" onclick={runAnalysis} disabled={!can_analyse}>
					Start analysis
				</button>
				{#if is_running}<button type="button" class="btn btn-secondary" onclick={cancelRun}>Cancel</button>{/if}
			</div>
			{#if !can_analyse && !is_running}
				<p class="form-hint">
					{#if !api_key_stored}
						Add your OpenRouter API key above first.
					{:else}
						Fill learning objective and request, then select at least one test model and one judge model.
					{/if}
				</p>
			{/if}
		{/if}
		<div class="run-meta">
			{#if key_loading}<span class="muted">Loading key info…</span>{/if}
			{#if key_error}<span class="form-error">{key_error}</span>{/if}
			{#if key_info}<pre class="key-info">{JSON.stringify(key_info, null, 2).slice(0, 300)}…</pre>{/if}
			<p class="cost-line">Estimated cost: <strong>{formatCost(estimated_cost_usd ?? null)}</strong> · Actual: <strong>{formatCost(actual_cost_usd || null)}</strong></p>
			<div class="run-buttons">
				{#if !viewing_run}
					<button type="button" class="btn btn-ghost btn-sm" onclick={() => fetchKeyInfo()}>Refresh key info</button>
				{/if}
				<button type="button" class="btn btn-ghost btn-sm" onclick={clearResults}>Clear results</button>
				<button type="button" class="btn btn-ghost btn-sm" onclick={exportJson}>Export JSON</button>
			</div>
		</div>
	</section>

	{#if model_results.length > 0}
		<section class="card progress-card">
			<h2 class="card-title">Progress</h2>
			<p class="progress-text">{completed_runs} / {total_runs} runs complete</p>
			<div class="progress-bar" role="progressbar" aria-valuenow={completed_runs} aria-valuemin={0} aria-valuemax={total_runs} title="{completed_runs} / {total_runs}">
				{#each run_statuses as status}
					<span
						class="progress-segment segment-{status === 'complete' || status === 'failed' ? 'done' : status === 'running' ? 'active' : 'pending'}"
						title={status}
					></span>
				{/each}
			</div>
			<div class="progress-log-wrap">
				<label class="form-label" for="progress-log">Log</label>
				<div id="progress-log" class="progress-log" role="log" aria-live="polite">
					{#if progress_log_lines.length === 0}
						<span class="progress-log-placeholder">Progress will appear here as runs and judge calls start and complete.</span>
					{:else}
						{#each progress_log_lines as line}
							<div class="progress-log-line" class:progress-log-error={line.isError} class:progress-log-generation={line.type === "generation"} class:progress-log-judge={line.type === "judge"}>{line.text}</div>
						{/each}
					{/if}
				</div>
			</div>
		</section>

		<section class="card results-card">
			<div class="card-header">
				<h2 class="card-title">Results</h2>
			</div>
			<div class="results-toolbar">
				<div class="results-view-toggle">
					<label><input type="radio" name="results-view" checked={!show_bars} onchange={() => show_bars = false} /> Numbers</label>
					<label><input type="radio" name="results-view" checked={show_bars} onchange={() => show_bars = true} /> Bars</label>
					{#if !show_bars}
						<label class="numbers-options"><input type="checkbox" bind:checked={show_std} /> Show ± variation</label>
					{/if}
					{#if show_bars}
						<label class="bar-scale-slider">
							Scale min: <input type="range" min="0" max="100" step="10" bind:value={bar_scale_min_user} />
							<span>{bar_scale_min_user}</span>
						</label>
						<span class="muted">({effective_bar_scale_min}–100)</span>
					{/if}
				</div>
				<div class="results-table-filters">
					<div class="filter-dropdown">
						<button type="button" class="btn btn-ghost btn-sm filter-dropdown-trigger" onclick={() => { rows_dropdown_open = !rows_dropdown_open; columns_dropdown_open = false; }} aria-haspopup="true" aria-expanded={rows_dropdown_open}>
							Rows
						</button>
						{#if rows_dropdown_open}
							<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_no_noninteractive_element_interactions -->
							<div class="filter-dropdown-backdrop" role="presentation" onclick={() => rows_dropdown_open = false}></div>
							<div class="filter-dropdown-panel" role="group" aria-label="Show or hide rows">
								{#each sorted_results as result}
									<label class="filter-dropdown-item">
										<input type="checkbox" checked={!hidden_model_ids.has(result.model_id)} onchange={() => toggleRowVisibility(result.model_id)} />
										<span>{result.model_label}</span>
									</label>
								{/each}
							</div>
						{/if}
					</div>
					<div class="filter-dropdown">
						<button type="button" class="btn btn-ghost btn-sm filter-dropdown-trigger" onclick={() => { columns_dropdown_open = !columns_dropdown_open; rows_dropdown_open = false; }} aria-haspopup="true" aria-expanded={columns_dropdown_open}>
							Columns
						</button>
						{#if columns_dropdown_open}
							<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_no_noninteractive_element_interactions -->
							<div class="filter-dropdown-backdrop" role="presentation" onclick={() => columns_dropdown_open = false}></div>
							<div class="filter-dropdown-panel" role="group" aria-label="Show or hide columns">
								{#each RESULT_COLUMNS as col}
									<label class="filter-dropdown-item">
										<input type="checkbox" checked={!hidden_column_ids.has(col.id)} onchange={() => toggleColumnVisibility(col.id)} />
										<span>{col.label}</span>
									</label>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			</div>
			<div class="table-wrap">
			<table class="results-table">
				<thead>
					<tr>
						{#each visible_columns as col}
							{#if col.id === "model"}
								<th>Model</th>
							{:else if col.id === "runs"}
								<th class="run-dots-header">Runs</th>
							{:else if col.id === "evals"}
								<th class="evals-col" title="Completed judge evaluations (runs × judges when finished)">Evals</th>
							{:else if col.id === "time"}
								<th class="time-col" onclick={() => { sort_column = "time"; sort_desc = !sort_desc; }} title='Generation call only (wall time). Judge calls not included.'>Time avg (s)</th>
							{:else if col.id === "cost"}
								<th class="cost-col">Cost / 1k runs</th>
							{:else if col.id === "consistency"}
								<th class="metric-col" onclick={() => { sort_column = "consistency"; sort_desc = !sort_desc; }}>Consistency %</th>
							{:else if col.id === "correctness"}
								<th class="metric-col" onclick={() => { sort_column = "correctness"; sort_desc = !sort_desc; }}>Correctness</th>
							{:else if col.id === "alignment"}
								<th class="metric-col" onclick={() => { sort_column = "alignment"; sort_desc = !sort_desc; }}>Alignment</th>
							{:else if col.id === "compliance"}
								<th class="metric-col" onclick={() => { sort_column = "compliance"; sort_desc = !sort_desc; }}>Compliance</th>
							{:else if col.id === "quality"}
								<th class="metric-col" onclick={() => { sort_column = "quality"; sort_desc = !sort_desc; }}>Quality avg</th>
							{/if}
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each visible_results as result}
						{@const evalsCompleted = result.runs.reduce((s, r) => s + r.judge_results.length, 0)}
						{@const evalsTotal = result.runs.length * selected_judge_models.size}
						<tr
							class="result-row"
							role="button"
							tabindex="0"
							onclick={() => expanded_model_id = expanded_model_id === result.model_id ? null : result.model_id}
							onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); expanded_model_id = expanded_model_id === result.model_id ? null : result.model_id; } }}
						>
							{#each visible_columns as col}
								{#if col.id === "model"}
									<td>{result.model_label}</td>
								{:else if col.id === "runs"}
									<td class="run-dots-cell">
										<div class="run-dots" title="Run status: grey=queued, orange=generating, green=judging/done">
											{#each result.runs as run}
												{@const phase = run.status === "queued" ? "queued" : run.status === "complete" || run.status === "failed" ? "done" : run.judge_results.length === 0 ? "generating" : run.judge_results.length < selected_judge_models.size ? "judging" : "done"}
												<span class="run-dot phase-{phase}" title="Run {run.run_index + 1}: {phase}"></span>
											{/each}
										</div>
									</td>
								{:else if col.id === "evals"}
									<td class="evals-col" class:evals-complete={evalsTotal > 0 && evalsCompleted === evalsTotal} class:evals-incomplete={evalsTotal > 0 && evalsCompleted < evalsTotal}>{evalsCompleted}/{evalsTotal}</td>
								{:else if col.id === "time"}
									<td class="time-col">{show_std && result.time_std_ms != null && result.time_std_ms > 0 ? (result.time_avg_ms / 1000).toFixed(1) + " ± " + (result.time_std_ms / 1000).toFixed(1) + " s" : formatTimeSeconds(result.time_avg_ms)}</td>
								{:else if col.id === "cost"}
									<td class="cost-col">{formatCost(result.cost_per_1000_runs ?? null)}</td>
								{:else if col.id === "consistency"}
									<td class="metric-col">
										{#if show_bars}
											<div class="bar-track"><div class="bar-fill" style="width: {barFillPct(result.consistency_percent)}%" title="{result.consistency_percent.toFixed(0)}%"></div></div>
										{:else}
											{result.consistency_percent.toFixed(0)}%
										{/if}
									</td>
								{:else if col.id === "correctness"}
									<td class="metric-col">
										{#if show_bars}
											<div class="bar-track"><div class="bar-fill" style="width: {barFillPct(result.correctness_avg)}%" title="{result.correctness_avg != null ? result.correctness_avg.toFixed(1) : '—'}"></div></div>
										{:else}
											{result.correctness_avg != null ? result.correctness_avg.toFixed(1) + (show_std && result.correctness_std != null ? " ± " + result.correctness_std.toFixed(1) : "") : "—"}
										{/if}
									</td>
								{:else if col.id === "alignment"}
									<td class="metric-col {result.correctness_avg != null && result.alignment_avg != null && result.correctness_avg - result.alignment_avg > 8 ? 'alignment-gap' : ''}" title="{result.correctness_avg != null && result.alignment_avg != null && result.correctness_avg - result.alignment_avg > 8 ? 'Notably lower than correctness; may indicate style/alignment drift.' : ''}">
										{#if show_bars}
											<div class="bar-track"><div class="bar-fill" style="width: {barFillPct(result.alignment_avg)}%" title="{result.alignment_avg != null ? result.alignment_avg.toFixed(1) : '—'}"></div></div>
										{:else}
											{result.alignment_avg != null ? result.alignment_avg.toFixed(1) + (show_std && result.alignment_std != null ? " ± " + result.alignment_std.toFixed(1) : "") : "—"}
										{/if}
									</td>
								{:else if col.id === "compliance"}
									<td class="metric-col">
										{#if show_bars}
											<div class="bar-track"><div class="bar-fill" style="width: {barFillPct(result.compliance_avg)}%" title="{result.compliance_avg != null ? result.compliance_avg.toFixed(1) : '—'}"></div></div>
										{:else}
											{result.compliance_avg != null ? result.compliance_avg.toFixed(1) + (show_std && result.compliance_std != null ? " ± " + result.compliance_std.toFixed(1) : "") : "—"}
										{/if}
									</td>
								{:else if col.id === "quality"}
									<td class="metric-col">
										{#if show_bars}
											<div class="bar-track"><div class="bar-fill" style="width: {barFillPct(result.quality_avg)}%" title="{result.quality_avg != null ? result.quality_avg.toFixed(1) : '—'}"></div></div>
										{:else}
											{result.quality_avg != null ? result.quality_avg.toFixed(1) + (show_std && result.quality_std != null ? " ± " + result.quality_std.toFixed(1) : "") : "—"}
										{/if}
									</td>
								{/if}
							{/each}
						</tr>
						{#if expanded_model_id === result.model_id}
							{@const run_idx = Math.min(details_run_index, result.runs.length - 1)}
							{@const run = result.runs[run_idx]}
							{@const questions = run?.quiz_json?.questions ?? []}
							{@const q_idx = questions.length > 0 ? Math.min(details_question_index, questions.length - 1) : 0}
							{@const question = questions[q_idx]}
							{@const runQualityScores = (run?.judge_results ?? []).filter((j) => !!j.parsed).map((j) => getNormalizedScores(j.parsed!).quality)}
							{@const runQualityStd = runQualityScores.length > 1 ? Math.sqrt(runQualityScores.reduce((s, x) => s + (x - (run?.run_quality_avg ?? 0)) ** 2, 0) / (runQualityScores.length - 1)) : null}
							<tr class="details-row">
								<td colspan={visible_column_count}>
									<div class="details-panel">
										<div class="details-left">
											<div class="details-run-nav">
												<div class="details-run-nav-heading">
													<h3>Run {run_idx + 1} of {result.runs.length}</h3>
													{#if run?.run_quality_avg != null}
														<span class="run-quality-inline">Quality: {run.run_quality_avg.toFixed(1)}{#if show_std && runQualityStd != null} ± {runQualityStd.toFixed(1)}{/if}</span>
													{/if}
												</div>
												{#if result.runs.length > 1}
													<span class="nav-buttons">
														<button type="button" class="btn-nav" disabled={run_idx <= 0} onclick={() => { details_run_index = run_idx - 1; details_question_index = 0; details_judge_index = 0; }}>← Prev</button>
														<button type="button" class="btn-nav" disabled={run_idx >= result.runs.length - 1} onclick={() => { details_run_index = run_idx + 1; details_question_index = 0; details_judge_index = 0; }}>Next →</button>
													</span>
												{/if}
											</div>
											<dl class="details-meta">
												<dt>Status</dt><dd>{run?.status ?? "—"}</dd>
												<dt>Time (gen)</dt><dd>{formatTimeSeconds(run?.wall_time_ms)}</dd>
												<dt>Consistency</dt><dd>{run?.consistency_pass ? "pass" : "fail"}</dd>
												{#if run?.parse_error}<dt>Parse error</dt><dd class="error">{run.parse_error}</dd>{/if}
											</dl>
											<h4>Judge results</h4>
											{#if run?.judge_results && run.judge_results.length > 0}
												{@const judge_idx = Math.min(details_judge_index, run.judge_results.length - 1)}
												{@const j = run.judge_results[judge_idx]}
												{@const scores = j.parsed ? getNormalizedScores(j.parsed) : null}
												{@const qe = j.parsed && isQuizEvalResponse(j.parsed) ? j.parsed : null}
												<div class="details-judge-nav">
													<span class="details-judge-nav-title">Judge {judge_idx + 1} of {run.judge_results.length}</span>
													{#if run.judge_results.length > 1}
														<span class="nav-buttons">
															<button type="button" class="btn-nav" disabled={judge_idx <= 0} onclick={() => details_judge_index = judge_idx - 1}>← Prev</button>
															<button type="button" class="btn-nav" disabled={judge_idx >= run.judge_results.length - 1} onclick={() => details_judge_index = judge_idx + 1}>Next →</button>
														</span>
													{/if}
												</div>
												<div class="details-judge-card">
													<dl class="details-judge-meta">
														<dt>Judge</dt><dd>{j.judge_label}</dd>
														<dt>Overall</dt><dd>{scores ? scores.quality.toFixed(0) : "—"}</dd>
														<dt>Conf.</dt><dd>{qe != null ? qe.confidence : "—"}</dd>
														<dt>Verdict</dt><dd>{qe?.summary?.verdict ?? "—"}</dd>
														<dt>Correctness</dt><dd>{scores ? scores.correctness.toFixed(0) : "—"}</dd>
														<dt>Alignment</dt><dd>{scores ? scores.alignment.toFixed(0) : "—"}</dd>
														<dt>Compliance</dt><dd>{scores ? scores.compliance.toFixed(0) : "—"}</dd>
														<dt>Notes / error</dt>
														<dd class="notes-cell">
															{#if j.parse_error}
																{j.parse_error}
															{:else if qe?.summary}
																{qe.summary.most_important_fix || (qe.summary.top_issues?.length ? qe.summary.top_issues.join("; ") : "—")}
															{:else if j.parsed && "notes" in j.parsed}
																{j.parsed.notes}
															{:else}
																—
															{/if}
														</dd>
													</dl>
													{#if qe?.rubric}
														<div class="details-judge-rubric">
															<dl class="rubric-dl">
																{#each Object.entries(qe.rubric) as [key, dim]}
																	<dt>{key.replace(/_/g, " ")}</dt>
																	<dd>{dim.score_0_4}/4 — {dim.evidence}</dd>
																{/each}
															</dl>
															{#if qe.summary?.top_strengths?.length}
																<p class="rubric-summary"><strong>Strengths:</strong> {qe.summary.top_strengths.join("; ")}</p>
															{/if}
															{#if qe.summary?.top_issues?.length}
																<p class="rubric-summary"><strong>Issues:</strong> {qe.summary.top_issues.join("; ")}</p>
															{/if}
														</div>
													{/if}
												</div>
											{:else}
												<p class="muted">No judge results</p>
											{/if}
										</div>
										<div class="details-right">
											{#if run?.quiz_json?.questions && run.quiz_json.questions.length > 0}
												<div class="details-question-nav">
													<h3>Question {q_idx + 1} of {questions.length}</h3>
													{#if questions.length > 1}
														<span class="nav-buttons">
															<button type="button" class="btn-nav" disabled={q_idx <= 0} onclick={() => details_question_index = q_idx - 1}>← Prev</button>
															<button type="button" class="btn-nav" disabled={q_idx >= questions.length - 1} onclick={() => details_question_index = q_idx + 1}>Next →</button>
														</span>
													{/if}
												</div>
												<div class="question-card">
													{#if question}
														<p class="question-text">{question.question}</p>
														{#if question.type === "multiple_choice" && question.choices?.length > 0}
															<ol class="question-choices" start="1">
																{#each question.choices as choice, i}
																	<li class="{i === question.answer_index ? 'correct' : ''}">{choice}</li>
																{/each}
															</ol>
														{/if}
														<p class="question-answer"><strong>Answer:</strong> {question.choices?.[question.answer_index] ?? "—"}</p>
														{#if question.explanation}<p class="question-explanation">{question.explanation}</p>{/if}
													{/if}
												</div>
											{:else}
												<p class="muted">{run?.parse_error ? "Quiz failed to parse." : run?.quiz_json ? "No questions." : "No quiz for this run."}</p>
											{/if}
											{#if run?.enrichment_generated_prompt}
												<div class="enrichment-prompt-section">
													<h4 class="enrichment-prompt-heading">Generated enrichment prompt</h4>
													<div class="enrichment-prompt-content">{run.enrichment_generated_prompt}</div>
												</div>
											{/if}
										</div>
										<div class="details-panel-footer">
											<button type="button" class="btn btn-ghost btn-sm" onclick={(e) => { e.stopPropagation(); hidden_model_ids = new Set([...hidden_model_ids, result.model_id]); expanded_model_id = null; }}>Hide</button>
										</div>
									</div>
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
			</div>
		</section>
	{/if}

	{#if show_leave_modal}
		<div class="leave-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="leave-modal-title">
			<div class="leave-modal" role="presentation" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
				<h2 id="leave-modal-title" class="leave-modal-title">Leave page?</h2>
				<p class="leave-modal-message">You currently have an analysis running. Closing or leaving the page will end the analysis.</p>
				<div class="leave-modal-actions">
					<button type="button" class="btn btn-secondary" onclick={() => { show_leave_modal = false; pending_navigate_url = null; }}>Stay</button>
					{#if pending_navigate_url === '/runs' || (pending_navigate_url && pending_navigate_url.startsWith('/runs'))}
						<button type="button" class="btn btn-secondary" onclick={() => { if (typeof window !== 'undefined') window.open(pending_navigate_url || '/runs', '_blank', 'noopener,noreferrer'); show_leave_modal = false; pending_navigate_url = null; }}>Open runs in new tab</button>
					{:else if pending_navigate_url === '/compare-runs' || (pending_navigate_url && pending_navigate_url.startsWith('/compare-runs'))}
						<button type="button" class="btn btn-secondary" onclick={() => { if (typeof window !== 'undefined') window.open(pending_navigate_url || '/compare-runs', '_blank', 'noopener,noreferrer'); show_leave_modal = false; pending_navigate_url = null; }}>Open compare in new tab</button>
					{/if}
					<button type="button" class="btn btn-primary" onclick={leaveAnyway}>Leave anyway</button>
				</div>
			</div>
		</div>
	{/if}

	{#if show_openrouter_overlay}
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div
			class="openrouter-overlay-backdrop"
			role="dialog"
			aria-modal="true"
			aria-labelledby="openrouter-overlay-title"
			tabindex="-1"
			onclick={() => (show_openrouter_overlay = false)}
			onkeydown={(e) => e.key === 'Escape' && (show_openrouter_overlay = false)}
		>
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div class="openrouter-overlay-panel" role="document" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
				<div class="openrouter-overlay-header">
					<h2 id="openrouter-overlay-title" class="openrouter-overlay-title">OpenRouter API key</h2>
					<button type="button" class="btn btn-ghost btn-sm openrouter-overlay-close" onclick={() => (show_openrouter_overlay = false)} aria-label="Close">×</button>
				</div>
				<p class="openrouter-overlay-subtitle">Why you need one and how to get it.</p>
				<div class="openrouter-overlay-prose">
					<h3>Why do I need an API key?</h3>
					<p>
						This app uses <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer">OpenRouter</a> to call language models: both to generate quizzes (test models) and to evaluate them (judge models). OpenRouter requires an API key so they can bill usage to your account. You pay OpenRouter for the API calls; this app does not charge you.
					</p>
					<p>
						Your key is stored only in your browser (session) and sent with each request to our server. We never log or store it.
					</p>
					<h3>How do I get an API key?</h3>
					<ol>
						<li>Go to <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer">openrouter.ai</a>.</li>
						<li>Sign in or create an account (e.g. with Google or GitHub).</li>
						<li>Open your <strong>Keys</strong> or <strong>API Keys</strong> section (e.g. from the dashboard or account menu).</li>
						<li>Create a new API key. You can name it (e.g. “Quiz Evaluator”) and optionally set usage limits.</li>
						<li>Copy the key (it usually starts with <code>sk-or-v1-</code>) and paste it into the “OpenRouter API key” field on the Evaluator page. Click <strong>Save key</strong>.</li>
					</ol>
					<p>
						Once the key is saved, you can select models and run evaluations. If you ever want to revoke access, delete the key in OpenRouter’s dashboard or use the <strong>Delete</strong> button next to “Key saved” on the Evaluator page.
					</p>
					<p>
						Each run can cost anything from $0.50 to $10 depending on how many models you test and how many runs per model you do. We show an estimate of the cost of each run before you start the run.
					</p>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.page { max-width: 1280px; margin: 0 auto; }
	.page-header { margin-bottom: var(--space-8); }
	.page-title { font-size: var(--text-2xl); font-weight: var(--font-bold); letter-spacing: -0.02em; margin: 0 0 var(--space-2) 0; color: var(--color-text); }
	.page-subtitle { font-size: var(--text-base); color: var(--color-text-muted); margin: 0; line-height: var(--leading-relaxed); max-width: 42ch; }
	.page-links { font-size: var(--text-sm); margin: var(--space-2) 0 0 0; }
	.page-links a { color: var(--color-accent); text-decoration: none; font-weight: var(--font-medium); }
	.page-links a:hover { text-decoration: underline; }
	.page-links-sep { color: var(--color-text-subtle); margin: 0 var(--space-1); }

	.banner {
		display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap;
		background: var(--color-accent-muted); color: var(--color-accent-hover);
		padding: var(--space-3) var(--space-4); margin-bottom: var(--space-6);
		border-radius: var(--radius-lg); border: 1px solid rgba(13, 148, 136, 0.2);
		font-size: var(--text-sm); font-weight: var(--font-medium);
	}
	.banner-text { margin-right: var(--space-1); }
	.banner-link { color: var(--color-accent); text-decoration: none; font-weight: var(--font-semibold); }
	.banner-link:hover { text-decoration: underline; }
	.banner-sep { opacity: 0.6; }

	.card {
		background: var(--color-surface); border: 1px solid var(--color-border);
		border-radius: var(--radius-xl); padding: var(--space-6);
		margin-bottom: var(--space-6); box-shadow: var(--shadow-sm);
		transition: box-shadow var(--transition-base);
	}
	.card:hover { box-shadow: var(--shadow-md); }
	.card-header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); margin-bottom: var(--space-4); flex-wrap: wrap; }
	.card-title { font-size: var(--text-lg); font-weight: var(--font-semibold); margin: 0 0 var(--space-4) 0; color: var(--color-text); }
	.card-header .card-title { margin-bottom: 0; }
	.card-title-row { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; margin-bottom: var(--space-4); }
	.card-title-row .card-title { margin-bottom: 0; }
	.whats-this-link {
		font-size: var(--text-sm); font-weight: var(--font-medium); color: var(--color-accent);
		background: none; border: none; padding: 0; cursor: pointer; white-space: nowrap;
		text-decoration: none; font-family: inherit;
	}
	.whats-this-link:hover { text-decoration: underline; }
	.card-actions { display: flex; align-items: center; gap: var(--space-1); flex-wrap: wrap; }
	.card-badge { font-size: var(--text-xs); font-weight: var(--font-medium); color: var(--color-text-muted); }

	.api-key-hint { margin: 0 0 var(--space-4) 0; }
	.api-key-saved { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap; }
	.api-key-badge { font-size: var(--text-sm); font-weight: var(--font-medium); color: var(--color-success); }
	.api-key-actions { display: flex; gap: var(--space-2); }
	.api-key-input-row { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
	.api-key-input { flex: 1; min-width: 200px; font-family: ui-monospace, monospace; }

	.form-group { margin-bottom: var(--space-4); }
	.form-group:last-child { margin-bottom: 0; }
	.form-group-check { display: flex; align-items: center; gap: var(--space-2); }
	.form-label { display: block; font-size: var(--text-sm); font-weight: var(--font-medium); color: var(--color-text); margin-bottom: var(--space-2); }
	.form-label-row { display: inline-flex; align-items: center; gap: var(--space-1); margin-bottom: var(--space-2); }
	.form-label-row .form-label { margin-bottom: 0; }
	.info-btn {
		display: inline-flex; align-items: center; justify-content: center;
		width: 1.25rem; height: 1.25rem; padding: 0;
		font-size: var(--text-xs); font-weight: var(--font-semibold); line-height: 1;
		color: var(--color-text-muted); background: var(--color-border);
		border: none; border-radius: var(--radius-full);
		cursor: help; transition: color var(--transition-fast), background var(--transition-fast);
	}
	.info-btn:hover { color: var(--color-accent); background: var(--color-accent-muted); }
	.info-trigger-wrap { position: relative; display: inline-flex; }
	.info-popover {
		position: absolute; z-index: 100;
		top: 100%; left: 0; margin-top: var(--space-1);
		font-size: var(--text-sm); line-height: var(--leading-relaxed); color: var(--color-text-muted);
		background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md);
		box-shadow: var(--shadow-lg); padding: var(--space-2) var(--space-3);
		width: max-content; max-width: 280px; min-width: 200px;
	}
	.form-group-check { flex-wrap: wrap; }
	.form-label-inline { font-size: var(--text-sm); font-weight: var(--font-medium); color: var(--color-text); cursor: pointer; }
	.form-value { color: var(--color-accent); font-weight: var(--font-semibold); }
	.form-hint { font-size: var(--text-sm); color: var(--color-text-muted); margin: var(--space-2) 0 0 0; }
	.form-hint-inline { margin-bottom: var(--space-1); }
	.form-hint-inline code { font-family: ui-monospace, monospace; font-size: var(--text-xs); background: var(--color-bg); padding: 0.125em 0.375em; border-radius: var(--radius-sm); }
	.form-error { font-size: var(--text-sm); color: var(--color-error); margin: 0 0 var(--space-2) 0; }
	.prompts-card-header {
		display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2);
		width: 100%; padding: 0; margin: 0; border: none; background: none; cursor: pointer; text-align: left;
		font-family: inherit; color: inherit;
	}
	.prompts-card-header:hover .prompts-card-title { color: var(--color-accent); }
	.prompts-card-chevron {
		display: inline-block; font-size: var(--text-sm); color: var(--color-text-muted); transition: transform var(--transition-fast);
	}
	.prompts-card-chevron-open { transform: rotate(90deg); }
	.prompts-card-title { margin: 0; transition: color var(--transition-fast); }
	.prompts-hint-inline { margin: 0; font-size: var(--text-sm); color: var(--color-text-muted); }
	.prompts-card-content {
		overflow: hidden; max-height: 0; opacity: 0; transition: max-height var(--transition-base), opacity var(--transition-base);
	}
	.prompts-card-content-open { max-height: 2000px; opacity: 1; }
	.prompts-card-content .form-group:first-child { margin-top: var(--space-4); }
	.prompts-hint { margin-bottom: var(--space-4); }
	.prompts-textarea { font-family: ui-monospace, monospace; font-size: var(--text-xs); min-height: 100px; resize: vertical; }
	.prompts-schema-block { margin-top: var(--space-3); }
	.prompts-schema-toggle {
		display: flex; align-items: center; gap: var(--space-2);
		width: 100%; padding: 0; margin: 0 0 var(--space-2) 0; border: none; background: none; cursor: pointer; text-align: left;
		font-family: inherit; color: inherit;
	}
	.prompts-schema-toggle:hover .prompts-schema-label { color: var(--color-accent); }
	.prompts-schema-chevron {
		display: inline-block; font-size: var(--text-xs); color: var(--color-text-muted); transition: transform var(--transition-fast); flex-shrink: 0;
	}
	.prompts-schema-chevron-open { transform: rotate(90deg); }
	.prompts-schema-label { display: inline; margin: 0; color: var(--color-text-muted); font-size: var(--text-xs); font-weight: var(--font-medium); transition: color var(--transition-fast); }
	.prompts-schema-label code { font-family: ui-monospace, monospace; background: var(--color-bg); padding: 0.125em 0.375em; border-radius: var(--radius-sm); }
	.prompts-schema-content {
		overflow: hidden; max-height: 0; opacity: 0; transition: max-height var(--transition-base), opacity var(--transition-base);
	}
	.prompts-schema-content-open { max-height: 800px; opacity: 1; padding-top: var(--space-2); }
	.prompts-schema-pre {
		font-family: ui-monospace, monospace; font-size: var(--text-xs); line-height: var(--leading-normal);
		background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md);
		padding: var(--space-3); margin: 0; overflow-x: auto; max-height: 200px; overflow-y: auto;
		white-space: pre; color: var(--color-text);
	}
	.prompts-actions { margin-top: var(--space-4); display: flex; gap: var(--space-2); flex-wrap: wrap; }

	.input {
		width: 100%; box-sizing: border-box;
		padding: var(--space-2) var(--space-3); font-size: var(--text-sm);
		border: 1px solid var(--color-border); border-radius: var(--radius-md);
		background: var(--color-surface); color: var(--color-text);
		transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
	}
	.input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-muted); }
	.input:disabled { opacity: 0.7; cursor: not-allowed; background: var(--color-bg); }
	.input-textarea { min-height: 80px; resize: vertical; }
	.input-select { cursor: pointer; max-width: 8rem; }
	.input-number { max-width: 6rem; }
	.input-checkbox { width: 1rem; height: 1rem; accent-color: var(--color-accent); cursor: pointer; }
	.input-range { width: 100%; max-width: 12rem; height: 6px; accent-color: var(--color-accent); cursor: pointer; }

	.btn {
		display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2);
		padding: var(--space-2) var(--space-4); font-size: var(--text-sm); font-weight: var(--font-semibold);
		border-radius: var(--radius-md); border: none; cursor: pointer;
		transition: background var(--transition-fast), color var(--transition-fast), transform var(--transition-fast);
	}
	.btn:disabled { opacity: 0.6; cursor: not-allowed; }
	.btn-primary { background: var(--color-accent); color: white; }
	.btn-primary:hover:not(:disabled) { background: var(--color-accent-hover); }
	.btn-primary:active:not(:disabled) { transform: scale(0.98); }
	.btn-secondary { background: var(--color-border); color: var(--color-text); }
	.btn-secondary:hover:not(:disabled) { background: var(--color-border-strong); }
	.btn-ghost { background: transparent; color: var(--color-text-muted); }
	.btn-ghost:hover:not(:disabled) { background: var(--color-bg); color: var(--color-text); }
	.btn-sm { padding: var(--space-1) var(--space-2); font-size: var(--text-xs); }

	.model-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--space-2); }
	.model-row {
		display: flex; align-items: center; gap: var(--space-3); font-size: var(--text-sm);
		padding: var(--space-2) var(--space-3); border-radius: var(--radius-md);
		border: 1px solid var(--color-border); background: var(--color-bg);
		cursor: pointer; transition: border-color var(--transition-fast), background var(--transition-fast);
	}
	.model-row:hover { border-color: var(--color-border-strong); background: var(--color-surface); }
	.model-row.unavailable { opacity: 0.6; }
	.model-label { flex: 0 0 auto; font-weight: var(--font-medium); color: var(--color-text); }
	.model-meta { flex: 1; font-size: var(--text-xs); color: var(--color-text-muted); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.user-models-heading { font-size: var(--text-base); font-weight: var(--font-semibold); margin: var(--space-6) 0 var(--space-2) 0; color: var(--color-text-muted); }
	.model-row-with-delete { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
	.model-row-inner { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--space-3); cursor: pointer; }
	.add-model-section { margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--color-border); }
	.add-model-form { display: flex; flex-direction: column; gap: var(--space-3); max-width: 400px; }
	.add-model-buttons { display: flex; gap: var(--space-2); flex-wrap: wrap; }

	.sampling-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: var(--space-4); }

	.run-actions { display: flex; gap: var(--space-2); margin-bottom: var(--space-4); flex-wrap: wrap; }
	.run-meta { font-size: var(--text-sm); color: var(--color-text-muted); }
	.cost-line { margin: var(--space-2) 0; }
	.run-buttons { display: flex; gap: var(--space-2); margin-top: var(--space-2); flex-wrap: wrap; }
	.key-info { font-size: var(--text-xs); max-height: 80px; overflow: auto; background: var(--color-bg); padding: var(--space-2); border-radius: var(--radius-sm); margin: var(--space-2) 0; }

	.muted { color: var(--color-text-muted); }

	.progress-card .card-title { margin-bottom: var(--space-2); }
	.progress-text { font-size: var(--text-sm); color: var(--color-text-muted); margin: 0 0 var(--space-3) 0; }
	.progress-bar {
		display: flex; flex-wrap: nowrap; height: 10px; border-radius: var(--radius-full);
		overflow: hidden; background: var(--color-border);
	}
	.progress-segment { flex: 1; min-width: 2px; transition: background var(--transition-base); }
	.progress-segment.segment-done { background: var(--color-success); }
	.progress-segment.segment-active { background: var(--color-warning); animation: pulse-active 0.8s ease-in-out infinite; }
	.progress-segment.segment-pending { background: var(--color-border-strong); }
	.progress-log-wrap { margin-top: var(--space-4); }
	.progress-log-wrap .form-label { margin-bottom: var(--space-2); }
	.progress-log {
		width: 100%; box-sizing: border-box; min-height: 120px; max-height: 240px; overflow-y: auto;
		font-size: var(--text-xs); font-family: ui-monospace, monospace; line-height: var(--leading-normal);
		padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-md);
		background: var(--color-bg); color: var(--color-text);
	}
	.progress-log-line { margin: 0; white-space: pre-wrap; word-break: break-word; }
	.progress-log-line.progress-log-generation { color: var(--color-warning); }
	.progress-log-line.progress-log-judge { color: var(--color-success); }
	.progress-log-line.progress-log-error { color: var(--color-error); font-weight: var(--font-medium); }
	.progress-log-placeholder { color: var(--color-text-muted); }
	@keyframes pulse-active { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }

	.results-toolbar { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); margin-bottom: var(--space-4); flex-wrap: wrap; }
	.results-view-toggle { display: flex; align-items: center; gap: var(--space-4); flex-wrap: wrap; }
	.results-view-toggle label { display: inline-flex; align-items: center; gap: var(--space-2); cursor: pointer; font-size: var(--text-sm); }
	.results-table-filters { display: flex; align-items: center; gap: var(--space-2); flex-shrink: 0; }
	.filter-dropdown { position: relative; }
	.filter-dropdown-trigger { white-space: nowrap; }
	.filter-dropdown-backdrop { position: fixed; inset: 0; z-index: 10; }
	.filter-dropdown-panel { position: absolute; top: 100%; right: 0; margin-top: var(--space-1); min-width: 12rem; max-height: 16rem; overflow-y: auto; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); padding: var(--space-2); z-index: 20; }
	.filter-dropdown-item { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-1) var(--space-2); font-size: var(--text-sm); cursor: pointer; border-radius: var(--radius-md); }
	.filter-dropdown-item:hover { background: var(--color-bg); }
	.filter-dropdown-item input[type="checkbox"] { cursor: pointer; accent-color: var(--color-accent); }
	.numbers-options { margin-left: var(--space-2); }
	.bar-scale-slider { display: inline-flex; align-items: center; gap: var(--space-2); }
	.bar-scale-slider input[type="range"] { width: 6rem; accent-color: var(--color-accent); }
	.table-wrap { overflow-x: auto; border-radius: var(--radius-lg); border: 1px solid var(--color-border); }
	.results-table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
	.results-table th, .results-table td { padding: var(--space-3) var(--space-4); text-align: left; border-bottom: 1px solid var(--color-border); }
	.results-table th { background: var(--color-bg); font-weight: var(--font-semibold); color: var(--color-text-muted); white-space: nowrap; cursor: pointer; user-select: none; }
	.results-table th:hover { color: var(--color-text); }
	.run-dots-header { width: 1%; white-space: nowrap; }
	.run-dots-cell { vertical-align: middle; }
	.run-dots { display: flex; gap: var(--space-1); align-items: center; flex-wrap: nowrap; }
	.run-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
	.run-dot.phase-queued { background: var(--color-border-strong); }
	.run-dot.phase-generating { background: var(--color-warning); animation: pulse-dot 0.8s ease-in-out infinite; }
	.run-dot.phase-judging { background: var(--color-success); animation: pulse-dot 0.8s ease-in-out infinite; }
	.run-dot.phase-done { background: var(--color-success); }
	@keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
	.bar-track { width: 100%; min-width: 60px; height: 8px; background: var(--color-border); border-radius: var(--radius-full); overflow: hidden; }
	.bar-fill { height: 100%; background: var(--color-accent); border-radius: var(--radius-full); transition: width var(--transition-base); }
	.evals-col { width: 4rem; min-width: 4rem; text-align: center; }
	.evals-col.evals-complete { color: var(--color-success); font-weight: var(--font-semibold); }
	.evals-col.evals-incomplete { color: var(--color-warning); }
	.time-col, .cost-col { width: 5rem; min-width: 5rem; }
	.metric-col { width: 6rem; min-width: 6rem; }
	tr.result-row { cursor: pointer; transition: background var(--transition-fast); }
	tr.result-row:hover { background: var(--color-bg); }
	tr.result-row:focus-within { outline: 2px solid var(--color-accent); outline-offset: -2px; }
	tr.result-row td { background: var(--color-surface); }
	tr.result-row:hover td { background: var(--color-bg); }
	td.alignment-gap { background: var(--color-warning-bg); }
	.details-row td { padding: 0; vertical-align: top; background: var(--color-bg); border-bottom: 1px solid var(--color-border); }
	.details-panel { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: auto auto; gap: var(--space-6); padding: var(--space-6); max-width: 100%; }
	@media (max-width: 700px) { .details-panel { grid-template-columns: 1fr; } }
	.details-panel-footer { grid-column: 1 / -1; display: flex; justify-content: flex-end; padding-top: var(--space-2); border-top: 1px solid var(--color-border); }
	.details-left { min-width: 0; }
	.details-right { min-width: 0; border-left: 1px solid var(--color-border); padding-left: var(--space-6); }
	@media (max-width: 700px) { .details-right { border-left: none; padding-left: 0; border-top: 1px solid var(--color-border); padding-top: var(--space-6); } }
	.details-run-nav, .details-question-nav, .details-judge-nav { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); margin-bottom: var(--space-3); flex-wrap: wrap; }
	.details-run-nav-heading { display: flex; align-items: baseline; gap: var(--space-3); flex-wrap: wrap; }
	.details-run-nav h3, .details-question-nav h3 { margin: 0; font-size: var(--text-base); font-weight: var(--font-semibold); }
	.run-quality-inline { font-size: var(--text-sm); color: var(--color-text-muted); font-weight: var(--font-medium); }
	.nav-buttons { display: inline-flex; gap: var(--space-2); }
	.btn-nav {
		display: inline-flex; align-items: center; justify-content: center;
		padding: var(--space-1) var(--space-3); font-size: var(--text-sm); font-weight: var(--font-medium);
		border-radius: var(--radius-md); border: 1px solid var(--color-border);
		background: var(--color-surface); color: var(--color-text);
		cursor: pointer; transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
	}
	.btn-nav:hover:not(:disabled) { background: var(--color-bg); border-color: var(--color-border-strong); color: var(--color-text); }
	.btn-nav:active:not(:disabled) { background: var(--color-border); }
	.btn-nav:disabled { opacity: 0.5; cursor: not-allowed; }
	.details-meta { display: grid; grid-template-columns: auto 1fr; gap: var(--space-1) var(--space-4); font-size: var(--text-sm); margin-bottom: var(--space-4); }
	.details-meta dt { color: var(--color-text-muted); margin: 0; }
	.details-meta dd { margin: 0; }
	.details-left h4 { margin: 0 0 var(--space-2) 0; font-size: var(--text-sm); font-weight: var(--font-semibold); }
	.details-judge-nav { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); margin-bottom: var(--space-3); flex-wrap: wrap; }
	.details-judge-nav-title { font-size: var(--text-sm); font-weight: var(--font-semibold); }
	.details-judge-card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: var(--space-4); }
	.details-judge-meta { display: grid; grid-template-columns: auto 1fr; gap: var(--space-1) var(--space-4); font-size: var(--text-sm); margin: 0; }
	.details-judge-meta dt { color: var(--color-text-muted); margin: 0; }
	.details-judge-meta dd { margin: 0; }
	.details-judge-rubric { margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--color-border); }
	.notes-cell { max-width: 220px; white-space: normal; word-wrap: break-word; overflow-wrap: break-word; }
	.rubric-dl { display: grid; grid-template-columns: auto 1fr; gap: var(--space-1) var(--space-3); margin: 0 0 var(--space-2) 0; }
	.rubric-dl dt { color: var(--color-text-muted); margin: 0; }
	.rubric-summary { margin: var(--space-1) 0 0 0; font-size: var(--text-xs); }
	.question-card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: var(--space-4); }
	.question-text { font-size: var(--text-base); margin: 0 0 var(--space-3) 0; line-height: var(--leading-relaxed); }
	.question-choices { margin: 0 0 var(--space-3) 0; padding-left: 1.25rem; }
	.question-choices li { margin-bottom: var(--space-1); }
	.question-choices li.correct { font-weight: var(--font-semibold); color: var(--color-success); }
	.question-answer { margin: 0 0 var(--space-2) 0; font-size: var(--text-sm); }
	.question-explanation { margin: 0; font-size: var(--text-sm); color: var(--color-text-muted); font-style: italic; }
	.enrichment-prompt-section { margin-top: var(--space-6); padding-top: var(--space-4); border-top: 1px solid var(--color-border); }
	.enrichment-prompt-heading { margin: 0 0 var(--space-2) 0; font-size: var(--text-sm); font-weight: var(--font-semibold); color: var(--color-text); }
	.enrichment-prompt-content { font-size: var(--text-sm); line-height: var(--leading-relaxed); white-space: pre-wrap; word-break: break-word; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-3); max-height: 12rem; overflow-y: auto; }

	.leave-modal-backdrop {
		position: fixed; inset: 0; z-index: 1000;
		display: flex; align-items: center; justify-content: center;
		background: rgba(15, 23, 42, 0.4); backdrop-filter: blur(4px);
		padding: var(--space-4);
	}
	.leave-modal {
		background: var(--color-surface); border: 1px solid var(--color-border);
		border-radius: var(--radius-xl); padding: var(--space-6);
		box-shadow: var(--shadow-lg); max-width: 420px; width: 100%;
	}
	.leave-modal-title { font-size: var(--text-lg); font-weight: var(--font-semibold); margin: 0 0 var(--space-3) 0; color: var(--color-text); }
	.leave-modal-message { font-size: var(--text-sm); color: var(--color-text-muted); line-height: var(--leading-relaxed); margin: 0 0 var(--space-5) 0; }
	.leave-modal-actions { display: flex; gap: var(--space-3); justify-content: flex-end; flex-wrap: wrap; }

	.openrouter-overlay-backdrop {
		position: fixed; inset: 0; z-index: 1000;
		display: flex; align-items: center; justify-content: center;
		background: rgba(15, 23, 42, 0.4); backdrop-filter: blur(4px);
		padding: var(--space-4); overflow-y: auto;
	}
	.openrouter-overlay-panel {
		background: var(--color-surface); border: 1px solid var(--color-border);
		border-radius: var(--radius-xl); padding: var(--space-6);
		box-shadow: var(--shadow-lg); max-width: 520px; width: 100%; max-height: calc(100vh - 2 * var(--space-4)); overflow-y: auto;
		margin: auto;
	}
	.openrouter-overlay-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); margin-bottom: var(--space-2); }
	.openrouter-overlay-title { font-size: var(--text-lg); font-weight: var(--font-semibold); margin: 0; color: var(--color-text); }
	.openrouter-overlay-close { font-size: var(--text-xl); line-height: 1; padding: var(--space-1); min-width: 2rem; }
	.openrouter-overlay-subtitle { font-size: var(--text-sm); color: var(--color-text-muted); margin: 0 0 var(--space-4) 0; line-height: var(--leading-relaxed); }
	.openrouter-overlay-prose { font-size: var(--text-sm); line-height: var(--leading-relaxed); }
	.openrouter-overlay-prose h3 { font-size: var(--text-base); font-weight: var(--font-semibold); margin: var(--space-4) 0 var(--space-2) 0; color: var(--color-text); }
	.openrouter-overlay-prose h3:first-child { margin-top: 0; }
	.openrouter-overlay-prose p { margin: 0 0 var(--space-3) 0; color: var(--color-text); }
	.openrouter-overlay-prose ol { margin: 0 0 var(--space-3) 0; padding-left: 1.25rem; }
	.openrouter-overlay-prose li { margin-bottom: var(--space-1); color: var(--color-text); }
	.openrouter-overlay-prose a { color: var(--color-accent); text-decoration: none; }
	.openrouter-overlay-prose a:hover { text-decoration: underline; }
	.openrouter-overlay-prose code { font-family: ui-monospace, monospace; font-size: 0.9em; background: var(--color-bg); padding: 0.125em 0.375em; border-radius: var(--radius-sm); }
</style>
