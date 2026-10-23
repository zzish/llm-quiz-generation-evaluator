<script lang="ts">
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { listRuns, deleteRun } from "#lib/db/runs.js";
	import type { StoredRunSummary } from "#lib/types/run.js";

	let runs = $state<StoredRunSummary[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let selectedRunIds = $state<Set<number>>(new Set());

	function toggleRunSelection(id: number) {
		selectedRunIds = selectedRunIds.has(id)
			? new Set([...selectedRunIds].filter((runId) => runId !== id))
			: new Set([...selectedRunIds, id]);
	}

	function compareRuns() {
		if (selectedRunIds.size === 0) return;
		goto(resolve(`/compare-runs?ids=${[...selectedRunIds].join(",")}`));
	}

	function load() {
		loading = true;
		error = null;
		listRuns({ limit: 50 })
			.then((list) => {
				runs = list;
			})
			.catch((e) => {
				error = e instanceof Error ? e.message : String(e);
			})
			.finally(() => {
				loading = false;
			});
	}

	async function removeRun(id: number, e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		try {
			await deleteRun(id);
			runs = runs.filter((r) => r.id !== id);
		} catch {
			// The run stays listed when IndexedDB refuses the delete.
		}
	}

	function formatDate(ms: number): string {
		return new Date(ms).toLocaleString();
	}

	onMount(() => {
		load();
		const onVisible = () => {
			if (typeof document !== "undefined" && document.visibilityState === "visible") load();
		};
		document.addEventListener("visibilitychange", onVisible);
		return () => document.removeEventListener("visibilitychange", onVisible);
	});
</script>

<svelte:head>
	<title>Past runs – LLM Quiz Generation Evaluator</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<h1 class="page-title">Past runs</h1>
		<p class="page-subtitle">View and manage your saved evaluation runs.</p>
		<div class="header-actions">
			<button type="button" class="btn btn-secondary btn-sm" onclick={compareRuns} disabled={loading || selectedRunIds.size === 0}>
				Compare runs
			</button>
			<button type="button" class="btn btn-ghost btn-sm" onclick={() => load()} disabled={loading}>
				{loading ? 'Loading…' : 'Refresh'}
			</button>
		</div>
	</header>

	{#if loading}
		<div class="card empty-state">
			<p class="muted">Loading runs…</p>
		</div>
	{:else if error}
		<div class="card empty-state error-state">
			<p class="form-error">{error}</p>
		</div>
	{:else if runs.length === 0}
		<div class="card empty-state">
			<p class="empty-text">No runs yet</p>
			<p class="muted">Run an evaluation on the Evaluator page to see results here.</p>
			<a href={resolve("/")} class="btn btn-primary">Go to Evaluator</a>
		</div>
	{:else}
		<p class="run-list-note muted">Select to compare</p>
		<ul class="run-list">
			{#each runs as run (run.id)}
				<li class="run-item">
					<article class="card run-card">
						<label class="run-checkbox-wrap">
							<input type="checkbox" class="run-checkbox" checked={selectedRunIds.has(run.id)} onchange={() => toggleRunSelection(run.id)} onclick={(e) => e.stopPropagation()} aria-label="Select to compare" />
						</label>
						<a href={resolve(`/?runId=${run.id}`)} class="run-main">
							<time class="run-date" datetime={new Date(run.started_at).toISOString()}>{formatDate(run.started_at)}</time>
							<p class="run-snippet">{run.learning_objective_snippet}</p>
							<p class="run-snippet run-request">{run.request_snippet}</p>
							<p class="run-meta">{run.model_count} models · {run.quality_avg != null ? "Quality " + run.quality_avg.toFixed(0) : "—"}</p>
						</a>
						<div class="run-actions">
							<a href={resolve(`/?runId=${run.id}`)} class="btn btn-primary btn-sm">View</a>
							<button type="button" class="btn btn-ghost btn-sm btn-danger" onclick={(e) => removeRun(run.id, e)}>Delete</button>
						</div>
					</article>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.page { max-width: 720px; margin: 0 auto; }
	.page-header { margin-bottom: var(--space-8); display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: var(--space-4); }
	.page-title { font-size: var(--text-2xl); font-weight: var(--font-bold); letter-spacing: -0.02em; margin: 0 0 var(--space-2) 0; color: var(--color-text); }
	.page-subtitle { font-size: var(--text-base); color: var(--color-text-muted); margin: 0; line-height: var(--leading-relaxed); }
	.header-actions { flex-shrink: 0; }

	.btn {
		display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2);
		padding: var(--space-2) var(--space-4); font-size: var(--text-sm); font-weight: var(--font-semibold);
		border-radius: var(--radius-md); border: none; cursor: pointer; text-decoration: none;
		transition: background var(--transition-fast), color var(--transition-fast);
	}
	.btn:disabled { opacity: 0.6; cursor: not-allowed; }
	.btn-primary { background: var(--color-accent); color: white; }
	.btn-primary:hover:not(:disabled) { background: var(--color-accent-hover); }
	.btn-ghost { background: transparent; color: var(--color-text-muted); }
	.btn-secondary { background: var(--color-border); color: var(--color-text); }
	.btn-secondary:hover:not(:disabled) { background: var(--color-border-strong); }
	.btn-ghost:hover:not(:disabled) { background: var(--color-bg); color: var(--color-text); }
	.btn-sm { padding: var(--space-1) var(--space-2); font-size: var(--text-xs); }
	.btn-danger { color: var(--color-error); }
	.btn-danger:hover:not(:disabled) { background: var(--color-error-bg); color: var(--color-error); }

	.card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-xl); padding: var(--space-6); box-shadow: var(--shadow-sm); }
	.empty-state { text-align: center; padding: var(--space-10); }
	.empty-state .form-error { margin-bottom: 0; }
	.empty-text { font-size: var(--text-lg); font-weight: var(--font-semibold); color: var(--color-text); margin: 0 0 var(--space-2) 0; }
	.empty-state .muted { margin: 0 0 var(--space-4) 0; }
	.empty-state .btn { margin-top: var(--space-2); }
	.error-state { border-color: var(--color-error); }

	.run-list-note { margin: 0 0 var(--space-2) 0; font-size: var(--text-sm); }
	.run-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-4); }
	.run-item { list-style: none; }
	.run-card {
		display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-4);
		transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
	}
	.run-checkbox-wrap { display: flex; align-items: center; gap: var(--space-2); flex-shrink: 0; cursor: pointer; }
	.run-checkbox { width: 1rem; height: 1rem; accent-color: var(--color-accent); cursor: pointer; }
	.run-card:hover { border-color: var(--color-border-strong); box-shadow: var(--shadow-md); }
	.run-main { flex: 1; min-width: 0; display: block; text-decoration: none; color: inherit; cursor: pointer; }
	.run-main:hover { color: var(--color-accent); }
	.run-date { display: block; font-size: var(--text-sm); font-weight: var(--font-semibold); color: var(--color-text); margin-bottom: var(--space-1); }
	.run-snippet { font-size: var(--text-sm); color: var(--color-text-muted); margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.run-request { margin-top: var(--space-1); }
	.run-meta { font-size: var(--text-xs); color: var(--color-text-subtle); margin: var(--space-2) 0 0 0; }
	.run-actions { display: flex; gap: var(--space-2); flex-shrink: 0; }
	.run-actions .btn { margin: 0; }

	.muted { color: var(--color-text-muted); }
	.form-error { color: var(--color-error); font-size: var(--text-sm); }
</style>
