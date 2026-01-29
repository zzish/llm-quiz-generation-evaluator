<script lang="ts">
	// Static content page
</script>

<svelte:head>
	<title>Learn more – LLM Quiz Generation Evaluator</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<h1 class="page-title">Learn more</h1>
		<p class="page-subtitle">What this tool does and how it works.</p>
	</header>

	<div class="prose">
		<h2>What it does</h2>
		<p>
			The LLM Quiz Generation Evaluator lets you compare how different language models perform at generating K–12 quizzes. You give a <strong>learning objective</strong> (e.g. a Common Core standard) and a <strong>request</strong> (e.g. “10 multiple-choice questions”). The tool runs several models, generates quizzes, scores them with judge models, and shows you quality, consistency, correctness, alignment, and cost so you can choose the best model for your use case.
		</p>

		<h2>How it works</h2>
		<ol>
			<li><strong>Inputs.</strong> You enter a learning objective (e.g. CCSS.Math.Content.3.OA.A.1) and a natural-language request (e.g. “10 questions covering different aspects of this objective”).</li>
			<li><strong>Test models.</strong> You select one or more “test” models (from the catalog or your own OpenRouter model IDs). Each model is prompted to generate a quiz in a fixed JSON schema.</li>
			<li><strong>Sampling.</strong> You choose how many runs per model, temperature, concurrency, and spacing. The tool runs each model multiple times (with optional temperature variation) to measure consistency.</li>
			<li><strong>Generation.</strong> For each run, the app calls OpenRouter to generate a quiz. Output is parsed and validated against the expected schema (question count, format, answer key).</li>
			<li><strong>Judging.</strong> Each valid quiz is sent to one or more “judge” models (frontier models by default). Judges score the quiz on compliance, alignment to the objective, correctness (including math verification), clarity, difficulty, coverage, distractors, pedagogy, and fairness. They also produce a summary and per-question audit.</li>
			<li><strong>Results.</strong> You see aggregates per test model: average quality, consistency (schema pass rate), correctness/alignment/compliance, time, and cost. You can expand a model to inspect individual runs, judge breakdowns, and question-level detail.</li>
		</ol>

		<h2>Data and API</h2>
		<p>
			Your OpenRouter API key is entered in the browser and sent with each request; it is not stored on our server. Runs and past results are stored locally in your browser (IndexedDB). You can export run data as JSON. All generation and judging goes through <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer">OpenRouter</a>, so you can use any model they support.
		</p>
	</div>
</div>

<style>
	.page { max-width: 720px; margin: 0 auto; }
	.page-header { margin-bottom: var(--space-8); }
	.page-title { font-size: var(--text-2xl); font-weight: var(--font-bold); letter-spacing: -0.02em; margin: 0 0 var(--space-2) 0; color: var(--color-text); }
	.page-subtitle { font-size: var(--text-base); color: var(--color-text-muted); margin: 0; line-height: var(--leading-relaxed); }
	.prose { font-size: var(--text-base); line-height: var(--leading-relaxed); }
	.prose h2 { font-size: var(--text-lg); font-weight: var(--font-semibold); margin: var(--space-6) 0 var(--space-2) 0; color: var(--color-text); }
	.prose h2:first-child { margin-top: 0; }
	.prose p { margin: 0 0 var(--space-4) 0; color: var(--color-text); }
	.prose ol { margin: 0 0 var(--space-4) 0; padding-left: 1.5rem; }
	.prose li { margin-bottom: var(--space-2); color: var(--color-text); }
	.prose a { color: var(--color-accent); text-decoration: none; }
	.prose a:hover { text-decoration: underline; }
</style>
