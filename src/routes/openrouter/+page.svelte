<script lang="ts">
	// Static content page
</script>

<svelte:head>
	<title>OpenRouter API key – LLM Quiz Generation Evaluator</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<h1 class="page-title">OpenRouter API key</h1>
		<p class="page-subtitle">Why you need one and how to get it.</p>
	</header>

	<div class="prose">
		<h2>Why do I need an API key?</h2>
		<p>
			This app uses <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer">OpenRouter</a> to call language models: both to generate quizzes (test models) and to evaluate them (judge models). OpenRouter requires an API key so they can bill usage to your account. You pay OpenRouter for the API calls; this app does not charge you.
		</p>
		<p>
			Your key is stored only in your browser (session) and sent with each request to our server. We never log or store it.
		</p>

		<h2>How do I get an API key?</h2>
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
	.prose code { font-family: ui-monospace, monospace; font-size: var(--text-sm); background: var(--color-bg); padding: 0.125em 0.375em; border-radius: var(--radius-sm); }
</style>
