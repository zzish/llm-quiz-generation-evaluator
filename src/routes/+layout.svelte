<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/stores';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="app-shell">
	<header class="header">
		<div class="header-inner">
			<a href="/" class="logo">
				<span class="logo-icon" aria-hidden="true">◇</span>
				<span class="logo-text">LLM Quiz Generation Evaluator</span>
			</a>
			<nav class="nav" aria-label="Main">
				<a href="/" class="nav-link" class:active={$page.url.pathname === '/'}>Evaluator</a>
				<a href="/runs" class="nav-link" class:active={$page.url.pathname === '/runs'}>Past runs</a>
			</nav>
		</div>
	</header>
	<main class="main">
		{@render children()}
	</main>
</div>

<style>
	.app-shell {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}
	.header {
		background: var(--color-surface);
		border-bottom: 1px solid var(--color-border);
		box-shadow: var(--shadow-sm);
		position: sticky;
		top: 0;
		z-index: 50;
	}
	.header-inner {
		max-width: 1280px;
		margin: 0 auto;
		padding: var(--space-4) var(--space-6);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-6);
	}
	.logo {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		text-decoration: none;
		color: var(--color-text);
		font-weight: var(--font-semibold);
		font-size: var(--text-lg);
		transition: color var(--transition-fast);
	}
	.logo:hover {
		color: var(--color-accent);
	}
	.logo-icon {
		color: var(--color-accent);
		font-size: 1.25em;
	}
	.nav {
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}
	.nav-link {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		text-decoration: none;
		font-size: var(--text-sm);
		font-weight: var(--font-medium);
		color: var(--color-text-muted);
		transition: color var(--transition-fast), background var(--transition-fast);
	}
	.nav-link:hover {
		color: var(--color-text);
		background: var(--color-bg);
	}
	.nav-link.active {
		color: var(--color-accent);
		background: var(--color-accent-muted);
	}
	.main {
		flex: 1;
		padding: var(--space-8) var(--space-6);
	}
	@media (max-width: 640px) {
		.header-inner { padding: var(--space-3) var(--space-4); }
		.main { padding: var(--space-6) var(--space-4); }
	}
</style>
