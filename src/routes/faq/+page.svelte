<script lang="ts">
	const faq: { q: string; a: string }[] = [
		{
			q: "Where is my API key stored?",
			a: "Your OpenRouter API key is kept only in your browser (sessionStorage) and sent with each request to our server. We do not log or store it. It is cleared when you close the tab unless you re-enter it.",
		},
		{
			q: "Why do I need an API key?",
			a: "The app calls OpenRouter to generate quizzes and to run judge models. OpenRouter requires an API key for billing. You can create one at openrouter.ai. You pay OpenRouter for usage; this app does not charge you.",
		},
		{
			q: "What are “test” vs “judge” models?",
			a: "Test models are the ones that generate quizzes (e.g. GPT-6 Luna, Claude Sonnet 5.5, Gemini 3.8 Flash). Judge models evaluate those quizzes—they score alignment, correctness, clarity, etc. By default all four frontier judges score every quiz, one per provider (GPT-6 Astra, Claude Opus 5.5, Gemini 4 Argon, Muse Wonder), so no single provider's blind spots decide a score.",
		},
		{
			q: "What does a judge’s reasoning effort change?",
			a: "Effort sets how long a judge reasons before it scores; it is sent to OpenRouter as reasoning.effort. Each judge offers only the levels its model accepts, and Default sends nothing, so the model uses its own default (shown in brackets). Reasoning is billed as output, so higher effort costs more and takes longer. On one 10-question quiz at their highest effort, measured through the providers’ own APIs, Gemini 4 Argon took about 75 seconds and wrote about 7,000 output tokens; Claude Opus 5.5 took about 5 minutes and wrote about 36,000.",
		},
		{
			q: "What does “consistency” mean in the results?",
			a: "Consistency is the share of runs where the model’s output passed our schema validation (valid JSON, correct structure, required fields). If a model often returns malformed or off-schema output, its consistency percentage will be lower.",
		},
		{
			q: "What are quality, correctness, alignment, and compliance?",
			a: "These come from the judge. Quality is the overall score (0–100). Correctness reflects whether the quiz content and answer key are right (judges verify math where applicable). Alignment measures how well the quiz matches the learning objective. Compliance is whether the quiz meets your request (e.g. question count, format).",
		},
		{
			q: "Where are my runs saved?",
			a: "Runs are saved in your browser using IndexedDB. They stay on your device. The “Past runs” page lists them; you can open a run to see results again or export as JSON. Clearing site data will remove them.",
		},
		{
			q: "Can I use a model that’s not in the list?",
			a: "Yes. In the Test models section, use “Add model” and enter the OpenRouter model ID (e.g. openai/gpt-6-luna). It’s stored in your browser and appears under “Your additional models.” You can select it like any catalog model.",
		},
		{
			q: "Why did a judge run fail or show a parse error?",
			a: "Judges return JSON. If the response was truncated (e.g. hit max tokens) or malformed, parsing fails. We use JSON mode and allow judges up to 64,000 output tokens, because their reasoning counts against that limit. If it still happens, try a lower effort, a different judge model or a shorter quiz.",
		},
		{
			q: "How is cost estimated?",
			a: "We use OpenRouter’s per-token pricing and token counts measured on a 10-question quiz: about 250 input and 4,000 output tokens per generation, and about 3,400 input tokens per judgment. Judge output is priced at each judge’s highest effort, from about 7,000 tokens for Gemini 4 Argon to about 36,000 for Claude Opus 5.5, so the estimate is an upper bound and lower efforts cost less. It is multiplied by a safety factor (1.5×) for longer quizzes and retries. Actual cost comes from OpenRouter’s response when available.",
		},
	];
</script>

<svelte:head>
	<title>FAQ – LLM Quiz Generation Evaluator</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<h1 class="page-title">FAQ</h1>
		<p class="page-subtitle">Common questions about the LLM Quiz Generation Evaluator.</p>
	</header>

	<dl class="faq-list">
		{#each faq as item (item.q)}
			<div class="faq-item">
				<dt class="faq-q">{item.q}</dt>
				<dd class="faq-a">{item.a}</dd>
			</div>
		{/each}
	</dl>
</div>

<style>
	.page { max-width: 720px; margin: 0 auto; }
	.page-header { margin-bottom: var(--space-8); }
	.page-title { font-size: var(--text-2xl); font-weight: var(--font-bold); letter-spacing: -0.02em; margin: 0 0 var(--space-2) 0; color: var(--color-text); }
	.page-subtitle { font-size: var(--text-base); color: var(--color-text-muted); margin: 0; line-height: var(--leading-relaxed); }
	.faq-list { margin: 0; }
	.faq-item { margin-bottom: var(--space-6); padding-bottom: var(--space-6); border-bottom: 1px solid var(--color-border); }
	.faq-item:last-child { margin-bottom: 0; padding-bottom: 0; border-bottom: none; }
	.faq-q { font-size: var(--text-base); font-weight: var(--font-semibold); color: var(--color-text); margin: 0 0 var(--space-2) 0; }
	.faq-a { font-size: var(--text-sm); line-height: var(--leading-relaxed); color: var(--color-text-muted); margin: 0; }
</style>
