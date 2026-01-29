<script lang="ts">
	import { onMount } from "svelte";
	import { page } from "$app/stores";
	import { getRun } from "$lib/db/runs";
	import type { StoredRun, ModelResult } from "$lib/types/run";

	type CompareMetric =
		| "quality_avg"
		| "correctness_avg"
		| "alignment_avg"
		| "compliance_avg"
		| "time_avg_ms"
		| "cost_per_1000_runs"
		| "consistency_percent";

	const METRIC_OPTIONS: { value: CompareMetric; label: string }[] = [
		{ value: "quality_avg", label: "Quality (avg)" },
		{ value: "correctness_avg", label: "Correctness" },
		{ value: "alignment_avg", label: "Alignment" },
		{ value: "compliance_avg", label: "Compliance" },
		{ value: "time_avg_ms", label: "Time (avg s)" },
		{ value: "cost_per_1000_runs", label: "Cost / 1k runs" },
		{ value: "consistency_percent", label: "Consistency %" },
	];

	let runs = $state<StoredRun[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let selectedMetric = $state<CompareMetric>("quality_avg");
	let show_bars = $state(false);
	let show_std = $state(true);
	let bar_scale_min_user = $state(80);
	let sort_column = $state<string>("learning_objective");
	let sort_desc = $state(true);
	let flip_rows_columns = $state(false);
	let hidden_run_ids = $state<Set<string>>(new Set());
	let hidden_model_ids = $state<Set<string>>(new Set());
	let runs_dropdown_open = $state(false);
	let models_dropdown_open = $state(false);
	let header_angle = $state(0);

	const idsParam = $derived($page.url.searchParams.get("ids") ?? "");
	const ids = $derived(
		idsParam
			.split(",")
			.map((s) => parseInt(s.trim(), 10))
			.filter((n) => !Number.isNaN(n) && n > 0)
	);

	const columns = $derived.by(() => {
		const modelMap = new Map<string, string>();
		for (const run of runs) {
			for (const m of run.model_results ?? []) {
				if (!modelMap.has(m.model_id)) modelMap.set(m.model_id, m.model_label);
			}
		}
		return Array.from(modelMap.entries()).map(([model_id, model_label]) => ({ model_id, model_label }));
	});

	const sortedRuns = $derived.by(() => {
		selectedMetric;
		const list = [...runs];
		const col = sort_column;
		const desc = sort_desc;
		if (col === "learning_objective") {
			list.sort((a, b) => {
				const sa = (a.learning_objective ?? "").toLowerCase();
				const sb = (b.learning_objective ?? "").toLowerCase();
				const cmp = sa.localeCompare(sb);
				return desc ? -cmp : cmp;
			});
		} else {
			list.sort((a, b) => {
				const va = getCellValue(a, col);
				const vb = getCellValue(b, col);
				const na = typeof va === "number" ? va : NaN;
				const nb = typeof vb === "number" ? vb : NaN;
				if (Number.isNaN(na) && Number.isNaN(nb)) return 0;
				if (Number.isNaN(na)) return desc ? -1 : 1;
				if (Number.isNaN(nb)) return desc ? 1 : -1;
				const cmp = na - nb;
				return desc ? -cmp : cmp;
			});
		}
		return list;
	});

	function setSort(col: string) {
		if (sort_column === col) sort_desc = !sort_desc;
		else {
			sort_column = col;
			sort_desc = true;
		}
	}

	const sortedModelRows = $derived.by(() => {
		if (!flip_rows_columns) return columns;
		const list = [...columns];
		const col = sort_column;
		const desc = sort_desc;
		if (col === "model") {
			list.sort((a, b) => {
				const cmp = a.model_label.localeCompare(b.model_label);
				return desc ? -cmp : cmp;
			});
		} else if (col.startsWith("run_")) {
			const runIdx = parseInt(col.slice(4), 10);
			const run = sortedRuns[runIdx];
			if (!run) return list;
			list.sort((a, b) => {
				const va = getCellValue(run, a.model_id);
				const vb = getCellValue(run, b.model_id);
				const na = typeof va === "number" ? va : NaN;
				const nb = typeof vb === "number" ? vb : NaN;
				if (Number.isNaN(na) && Number.isNaN(nb)) return 0;
				if (Number.isNaN(na)) return desc ? -1 : 1;
				if (Number.isNaN(nb)) return desc ? 1 : -1;
				const cmp = na - nb;
				return desc ? -cmp : cmp;
			});
		} else if (col === "average") {
			list.sort((a, b) => {
				const valsA = getColumnValues(a.model_id);
				const valsB = getColumnValues(b.model_id);
				const na = valsA.length > 0 ? mean(valsA) : NaN;
				const nb = valsB.length > 0 ? mean(valsB) : NaN;
				if (Number.isNaN(na) && Number.isNaN(nb)) return 0;
				if (Number.isNaN(na)) return desc ? -1 : 1;
				if (Number.isNaN(nb)) return desc ? 1 : -1;
				const cmp = na - nb;
				return desc ? -cmp : cmp;
			});
		}
		return list;
	});

	const visible_runs = $derived(sortedRuns.filter((r) => !hidden_run_ids.has(r.run_id)));
	const visible_models = $derived(columns.filter((c) => !hidden_model_ids.has(c.model_id)));
	const visible_model_rows = $derived.by(() =>
		sortedModelRows.filter((col) => !hidden_model_ids.has(col.model_id))
	);

	function toggleRunVisibility(run_id: string) {
		const next = new Set(hidden_run_ids);
		if (next.has(run_id)) next.delete(run_id);
		else next.add(run_id);
		hidden_run_ids = next;
	}

	function toggleModelVisibility(model_id: string) {
		const next = new Set(hidden_model_ids);
		if (next.has(model_id)) next.delete(model_id);
		else next.add(model_id);
		hidden_model_ids = next;
	}

	function getRunColumnValues(run: StoredRun): number[] {
		return visible_models
			.map((col) => getCellValue(run, col.model_id))
			.filter((v): v is number => typeof v === "number");
	}

	const isZeroToHundredMetric = $derived(
		selectedMetric !== "time_avg_ms" && selectedMetric !== "cost_per_1000_runs"
	);
	const effective_bar_scale_min = $derived(
		show_bars && isZeroToHundredMetric ? Math.max(0, Math.min(100, Number(bar_scale_min_user) || 0)) : 0
	);
	const allNumericValues = $derived.by(() => {
		selectedMetric;
		const vals: number[] = [];
		for (const run of runs) {
			for (const col of columns) {
				const v = getCellValue(run, col.model_id);
				if (typeof v === "number" && !Number.isNaN(v)) vals.push(v);
			}
		}
		return vals;
	});
	const barScaleMax = $derived.by(() => {
		if (allNumericValues.length === 0) return 100;
		const m = Math.max(...allNumericValues);
		return m > 0 ? m : 100;
	});

	function barFillPct(value: number | null | undefined): number {
		if (value == null || typeof value !== "number" || Number.isNaN(value)) return 0;
		if (isZeroToHundredMetric) {
			const range = 100 - effective_bar_scale_min;
			if (range <= 0) return 100;
			return Math.max(0, Math.min(100, ((value - effective_bar_scale_min) / range) * 100));
		}
		const max = barScaleMax;
		if (max <= 0) return 0;
		return Math.max(0, Math.min(100, (value / max) * 100));
	}

	function getCellValue(run: StoredRun, modelId: string): string | number | null {
		const result = run.model_results?.find((m) => m.model_id === modelId) as ModelResult | undefined;
		if (!result) return null;
		const raw = result[selectedMetric];
		if (raw == null) return null;
		switch (selectedMetric) {
			case "time_avg_ms":
				return typeof raw === "number" ? raw / 1000 : raw;
			case "cost_per_1000_runs":
				return typeof raw === "number" ? raw : raw;
			default:
				return raw;
		}
	}

	function formatCell(value: string | number | null): string {
		if (value == null) return "—";
		switch (selectedMetric) {
			case "time_avg_ms":
				return typeof value === "number" ? value.toFixed(1) + " s" : String(value);
			case "cost_per_1000_runs":
				return typeof value === "number" ? (value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`) : String(value);
			case "consistency_percent":
				return typeof value === "number" ? value.toFixed(0) + "%" : String(value);
			default:
				return typeof value === "number" ? value.toFixed(1) : String(value);
		}
	}

	function snippet(s: string, maxLen: number): string {
		if (typeof s !== "string") return "";
		return s.length <= maxLen ? s : s.slice(0, maxLen) + "…";
	}

	function mean(values: number[]): number {
		if (values.length === 0) return NaN;
		return values.reduce((a, b) => a + b, 0) / values.length;
	}

	function std(values: number[], m?: number): number | null {
		if (values.length <= 1) return null;
		const avg = m ?? mean(values);
		const variance = values.reduce((s, x) => s + (x - avg) ** 2, 0) / (values.length - 1);
		return Math.sqrt(variance);
	}

	function getColumnValues(modelId: string): number[] {
		return visible_runs
			.map((run) => getCellValue(run, modelId))
			.filter((v): v is number => typeof v === "number");
	}

	function formatFooterCell(avg: number, stdVal: number | null, showVariation: boolean): string {
		if (Number.isNaN(avg)) return "—";
		const showStd = showVariation && stdVal != null;
		switch (selectedMetric) {
			case "time_avg_ms":
				return showStd ? `${avg.toFixed(1)} ± ${stdVal!.toFixed(1)} s` : `${avg.toFixed(1)} s`;
			case "cost_per_1000_runs":
				return showStd ? `$${avg.toFixed(2)} ± $${stdVal!.toFixed(2)}` : (avg < 0.01 ? `$${avg.toFixed(4)}` : `$${avg.toFixed(2)}`);
			case "consistency_percent":
				return showStd ? `${avg.toFixed(0)} ± ${stdVal!.toFixed(0)}%` : `${avg.toFixed(0)}%`;
			default:
				return showStd ? `${avg.toFixed(1)} ± ${stdVal!.toFixed(1)}` : avg.toFixed(1);
		}
	}

	$effect(() => {
		const idList = ids;
		if (idList.length === 0) {
			runs = [];
			loading = false;
			error = null;
			return;
		}
		loading = true;
		error = null;
		Promise.all(idList.map((id) => getRun(id)))
			.then((results) => {
				runs = results.filter((r): r is StoredRun => r != null);
				loading = false;
			})
			.catch((e) => {
				error = e instanceof Error ? e.message : String(e);
				loading = false;
			});
	});
</script>

<svelte:head>
	<title>Compare runs – LLM Quiz Generation Evaluator</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<h1 class="page-title">Compare runs</h1>
		<p class="page-subtitle">Compare metrics across selected runs. {flip_rows_columns ? "Rows are models; columns are runs." : "Rows are learning objectives; columns are models."}</p>
		<div class="header-actions">
			<label class="metric-select-wrap">
				<span class="metric-select-label">Show</span>
				<select class="input input-select metric-select" bind:value={selectedMetric} aria-label="Metric to display">
					{#each METRIC_OPTIONS as opt}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
			</label>
			<a href="/runs" class="btn btn-ghost btn-sm">← Back to past runs</a>
		</div>
	</header>

	{#if ids.length === 0}
		<div class="card empty-state">
			<p class="muted">No runs selected. Go to <a href="/runs">Past runs</a> and check runs, then click Compare runs.</p>
		</div>
	{:else if loading}
		<div class="card empty-state">
			<p class="muted">Loading runs…</p>
		</div>
	{:else if error}
		<div class="card empty-state error-state">
			<p class="form-error">{error}</p>
		</div>
	{:else if runs.length === 0}
		<div class="card empty-state">
			<p class="muted">Could not load any of the selected runs.</p>
		</div>
	{:else}
		<div class="compare-toolbar">
				<div class="compare-view-toggle">
					<label title="Rows = models, Columns = runs"><input type="checkbox" bind:checked={flip_rows_columns} /> Flip rows & columns</label>
					<label><input type="radio" name="compare-view" checked={!show_bars} onchange={() => (show_bars = false)} /> Numbers</label>
					<label><input type="radio" name="compare-view" checked={show_bars} onchange={() => (show_bars = true)} /> Bars</label>
					{#if !show_bars}
						<label class="numbers-options"><input type="checkbox" bind:checked={show_std} /> Show ± variation</label>
					{/if}
					{#if show_bars}
						{#if isZeroToHundredMetric}
							<label class="bar-scale-slider">
								Scale min: <input type="range" min="0" max="100" step="10" bind:value={bar_scale_min_user} />
								<span>{bar_scale_min_user}</span>
							</label>
							<span class="muted">({effective_bar_scale_min}–100)</span>
						{:else}
							<span class="muted">Scale 0–{barScaleMax.toFixed(1)}</span>
						{/if}
					{/if}
					<label class="header-angle-slider" title="Tilt column headers to reduce overlap">
						Header angle: <input type="range" min="0" max="90" step="5" bind:value={header_angle} />
						<span>{header_angle}°</span>
					</label>
				</div>
				<div class="compare-table-filters">
					<div class="filter-dropdown">
						<button type="button" class="btn btn-ghost btn-sm filter-dropdown-trigger" onclick={() => { runs_dropdown_open = !runs_dropdown_open; models_dropdown_open = false; }} aria-haspopup="true" aria-expanded={runs_dropdown_open}>
							Runs
						</button>
						{#if runs_dropdown_open}
							<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_no_noninteractive_element_interactions -->
							<div class="filter-dropdown-backdrop" role="presentation" onclick={() => runs_dropdown_open = false}></div>
							<div class="filter-dropdown-panel" role="group" aria-label="Show or hide runs">
								{#each sortedRuns as run}
									<label class="filter-dropdown-item">
										<input type="checkbox" checked={!hidden_run_ids.has(run.run_id)} onchange={() => toggleRunVisibility(run.run_id)} />
										<span>{snippet(run.learning_objective, 60)}</span>
									</label>
								{/each}
							</div>
						{/if}
					</div>
					<div class="filter-dropdown">
						<button type="button" class="btn btn-ghost btn-sm filter-dropdown-trigger" onclick={() => { models_dropdown_open = !models_dropdown_open; runs_dropdown_open = false; }} aria-haspopup="true" aria-expanded={models_dropdown_open}>
							Models
						</button>
						{#if models_dropdown_open}
							<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_no_noninteractive_element_interactions -->
							<div class="filter-dropdown-backdrop" role="presentation" onclick={() => models_dropdown_open = false}></div>
							<div class="filter-dropdown-panel" role="group" aria-label="Show or hide models">
								{#each columns as col}
									<label class="filter-dropdown-item">
										<input type="checkbox" checked={!hidden_model_ids.has(col.model_id)} onchange={() => toggleModelVisibility(col.model_id)} />
										<span>{col.model_label}</span>
									</label>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			</div>
		<div class="table-wrap" style="--header-angle: {header_angle}">
			{#if flip_rows_columns}
				<table class="compare-table">
					<thead>
						<tr>
							<th class="compare-row-header compare-th-sortable" role="button" tabindex="0" onclick={() => setSort("model")} onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSort("model"); } }} title="Sort by model">Model {#if sort_column === "model"}{sort_desc ? "↓" : "↑"}{/if}</th>
							{#each visible_runs as run, runIdx}
								{@const sortIdx = sortedRuns.indexOf(run)}
								<th class="compare-cell compare-th-sortable compare-th-column" role="button" tabindex="0" onclick={() => setSort("run_" + sortIdx)} onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSort("run_" + sortIdx); } }} title={run.learning_objective}>
									<span class="compare-th-inner">
										{#if run.id != null}
											<a href="/?runId={run.id}" class="compare-run-link" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>{snippet(run.learning_objective, 50)}</a>
										{:else}
											{snippet(run.learning_objective, 50)}
										{/if}
										{#if sort_column === "run_" + sortIdx}{sort_desc ? "↓" : "↑"}{/if}
									</span>
								</th>
							{/each}
							<th class="compare-cell compare-th-sortable compare-footer-label compare-th-column" role="button" tabindex="0" onclick={() => setSort("average")} onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSort("average"); } }} title="Sort by average">
									<span class="compare-th-inner">Average {#if sort_column === "average"}{sort_desc ? "↓" : "↑"}{/if}</span>
								</th>
						</tr>
					</thead>
					<tbody>
						{#each visible_model_rows as col}
							{@const modelValues = getColumnValues(col.model_id)}
							{@const modelAvg = mean(modelValues)}
							{@const modelStd = std(modelValues, modelAvg)}
							<tr>
								<td class="compare-row-header" title={col.model_label}>{col.model_label}</td>
								{#each visible_runs as run}
									{@const val = getCellValue(run, col.model_id)}
									<td class="compare-cell">
										{#if show_bars}
											<div class="bar-track"><div class="bar-fill" style="width: {barFillPct(typeof val === "number" ? val : null)}%" title={formatCell(val)}></div></div>
										{:else}
											{formatCell(val)}
										{/if}
									</td>
								{/each}
								<td class="compare-cell compare-footer-cell">
									{#if show_bars}
										<div class="bar-track"><div class="bar-fill" style="width: {barFillPct(modelAvg)}%" title={formatFooterCell(modelAvg, modelStd, true)}></div></div>
									{:else}
										{formatFooterCell(modelAvg, modelStd, show_std)}
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{:else}
				<table class="compare-table">
					<thead>
						<tr>
							<th class="compare-row-header compare-th-sortable" role="button" tabindex="0" onclick={() => setSort("learning_objective")} onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSort("learning_objective"); } }} title="Sort by learning objective">Learning objective {#if sort_column === "learning_objective"}{sort_desc ? "↓" : "↑"}{/if}</th>
							{#each visible_models as col}
								<th class="compare-cell compare-th-sortable compare-th-column" role="button" tabindex="0" onclick={() => setSort(col.model_id)} onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSort(col.model_id); } }} title="Sort by {col.model_label}">
									<span class="compare-th-inner">{col.model_label} {#if sort_column === col.model_id}{sort_desc ? "↓" : "↑"}{/if}</span>
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each visible_runs as run}
							<tr>
								<td class="compare-row-header" title={run.learning_objective}>
									{#if run.id != null}
										<a href="/?runId={run.id}" class="compare-run-link">{snippet(run.learning_objective, 70)}</a>
									{:else}
										{snippet(run.learning_objective, 70)}
									{/if}
								</td>
								{#each visible_models as col}
									{@const val = getCellValue(run, col.model_id)}
									<td class="compare-cell">
										{#if show_bars}
											<div class="bar-track"><div class="bar-fill" style="width: {barFillPct(typeof val === "number" ? val : null)}%" title={formatCell(val)}></div></div>
										{:else}
											{formatCell(val)}
										{/if}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
					<tfoot>
						<tr class="compare-footer-row">
							<td class="compare-row-header compare-footer-label">Average</td>
							{#each visible_models as col}
								{@const values = getColumnValues(col.model_id)}
								{@const avg = mean(values)}
								{@const stdVal = std(values, avg)}
								<td class="compare-cell compare-footer-cell">
									{#if show_bars}
										<div class="bar-track"><div class="bar-fill" style="width: {barFillPct(avg)}%" title={formatFooterCell(avg, stdVal, true)}></div></div>
									{:else}
										{formatFooterCell(avg, stdVal, show_std)}
									{/if}
								</td>
							{/each}
						</tr>
					</tfoot>
				</table>
			{/if}
		</div>
	{/if}
</div>

<style>
	.page { max-width: 1280px; margin: 0 auto; }
	.page-header { margin-bottom: var(--space-8); display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: var(--space-4); }
	.page-title { font-size: var(--text-2xl); font-weight: var(--font-bold); letter-spacing: -0.02em; margin: 0 0 var(--space-2) 0; color: var(--color-text); }
	.page-subtitle { font-size: var(--text-base); color: var(--color-text-muted); margin: 0; line-height: var(--leading-relaxed); }
	.header-actions { display: flex; align-items: center; gap: var(--space-4); flex-wrap: wrap; flex-shrink: 0; }
	.metric-select-wrap { display: flex; align-items: center; gap: var(--space-2); }
	.metric-select-label { font-size: var(--text-sm); color: var(--color-text-muted); }
	.metric-select { min-width: 10rem; }
	.input { font-size: var(--text-sm); padding: var(--space-2) var(--space-3); border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-surface); }
	.input-select { cursor: pointer; }

	.btn {
		display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2);
		padding: var(--space-2) var(--space-4); font-size: var(--text-sm); font-weight: var(--font-semibold);
		border-radius: var(--radius-md); border: none; cursor: pointer; text-decoration: none;
		transition: background var(--transition-fast), color var(--transition-fast);
	}
	.btn-ghost { background: transparent; color: var(--color-text-muted); }
	.btn-ghost:hover { background: var(--color-bg); color: var(--color-text); }
	.btn-sm { padding: var(--space-1) var(--space-2); font-size: var(--text-xs); }

	.card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-xl); padding: var(--space-6); box-shadow: var(--shadow-sm); }
	.empty-state { text-align: center; padding: var(--space-10); }
	.empty-state .muted { margin: 0; }
	.empty-state a { color: var(--color-accent); }
	.error-state { border-color: var(--color-error); }
	.form-error { font-size: var(--text-sm); color: var(--color-error); margin: 0; }

	.compare-toolbar { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); margin-bottom: var(--space-4); flex-wrap: wrap; }
	.compare-view-toggle { display: flex; align-items: center; gap: var(--space-4); flex-wrap: wrap; }
	.compare-view-toggle label { display: inline-flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); cursor: pointer; }
	.compare-table-filters { display: flex; align-items: center; gap: var(--space-2); flex-shrink: 0; }
	.filter-dropdown { position: relative; }
	.filter-dropdown-trigger { white-space: nowrap; }
	.filter-dropdown-backdrop { position: fixed; inset: 0; z-index: 10; }
	.filter-dropdown-panel { position: absolute; top: 100%; right: 0; margin-top: var(--space-1); min-width: 14rem; max-height: 16rem; overflow-y: auto; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); padding: var(--space-2); z-index: 20; }
	.filter-dropdown-item { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-1) var(--space-2); font-size: var(--text-sm); cursor: pointer; border-radius: var(--radius-md); }
	.filter-dropdown-item:hover { background: var(--color-bg); }
	.filter-dropdown-item input[type="checkbox"] { cursor: pointer; accent-color: var(--color-accent); }
	.compare-view-toggle input[type="radio"], .compare-view-toggle input[type="checkbox"] { cursor: pointer; accent-color: var(--color-accent); }
	.numbers-options { margin-left: var(--space-2); }
	.bar-scale-slider { display: inline-flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); }
	.bar-scale-slider input[type="range"] { width: 6rem; accent-color: var(--color-accent); }
	.header-angle-slider { display: inline-flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); }
	.header-angle-slider input[type="range"] { width: 5rem; accent-color: var(--color-accent); }
	.bar-track { width: 100%; min-width: 60px; height: 8px; background: var(--color-border); border-radius: var(--radius-full); overflow: hidden; }
	.bar-fill { height: 100%; background: var(--color-accent); border-radius: var(--radius-full); transition: width var(--transition-base); }
	.table-wrap { overflow-x: auto; }
	.compare-table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: var(--text-sm); }
	.compare-table th, .compare-table td { padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border); text-align: left; }
	.compare-table th { background: var(--color-bg); font-weight: var(--font-semibold); }
	.compare-table thead tr { min-height: calc(2.5em + (var(--header-angle, 0) / 90) * 14em); }
	.compare-table th.compare-th-column {
		vertical-align: bottom;
		padding-bottom: var(--space-2);
		min-height: calc(2.5em + (var(--header-angle, 0) / 90) * 14em);
		height: calc(2.5em + (var(--header-angle, 0) / 90) * 14em);
	}
	.compare-table th.compare-th-column .compare-th-inner {
		display: inline-block;
		transform: rotate(calc(-1 * var(--header-angle, 0) * 1deg));
		transform-origin: bottom left;
		white-space: nowrap;
	}
	.compare-th-sortable { cursor: pointer; user-select: none; }
	.compare-th-sortable:hover { background: var(--color-border); }
	.compare-row-header { width: 220px; min-width: 160px; max-width: 320px; }
	.compare-run-link { color: var(--color-text); text-decoration: none; }
	.compare-run-link:hover { color: var(--color-accent); text-decoration: underline; }
	.compare-cell { width: 7rem; min-width: 7rem; }
	.compare-footer-row { background: var(--color-bg); font-weight: var(--font-semibold); }
	.compare-footer-label { color: var(--color-text-muted); }
	.compare-footer-cell { white-space: nowrap; }

	.muted { color: var(--color-text-muted); }
</style>
