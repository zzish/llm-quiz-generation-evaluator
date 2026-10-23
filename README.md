# LLM Quiz Generation Evaluator

A web app for comparing how different large language models (LLMs) perform at generating K–12 quizzes. You provide a **learning objective** (e.g. a Common Core standard) and a **request** (e.g. “10 multiple-choice questions”). The app runs multiple models, generates quizzes, scores them with judge models, and shows quality, consistency, correctness, alignment, cost, and timing so you can choose the best model for your use case.

In the web app, all generation and judging go through [OpenRouter](https://openrouter.ai), so you can use any model they support (OpenAI, Anthropic, Google, Mistral, Meta, and more). The command-line [batch runner](#batch-runner-command-line) calls each provider's own API instead, with the same prompts and parsers.

---

## What it does

- **Compare test models** – Select one or more “test” models from a catalog (or add your own OpenRouter model IDs). Each model is prompted to generate a quiz in a fixed JSON schema.
- **Run multiple samples** – Configure runs per model, temperature, concurrency, and spacing to measure consistency and variation.
- **Judge quality** – Each valid quiz is scored by one or more “judge” models (e.g. frontier models) on compliance, alignment, correctness, clarity, difficulty, coverage, and pedagogy.
- **View results** – See per-model aggregates: average quality, consistency (schema pass rate), correctness/alignment/compliance, time, and cost. Expand a model to inspect individual runs, judge breakdowns, and question-level detail.
- **Save and compare runs** – Save runs to local storage (IndexedDB), then select multiple runs and compare them side-by-side in a table (with optional flip of rows/columns, filters, and tilted column headers).
- **Customize prompts** – Edit the generation, judge, and optional enrichment prompt templates and the quiz JSON schema from the UI.

Your OpenRouter API key is entered in the browser and sent with each request; it is not stored on the server. Run data is stored locally in your browser.

---

## Prerequisites

- **Node.js** 24+ (the batch runner and the tests run the TypeScript sources directly; tested on 24.14)
- **npm** (or pnpm / yarn)
- An **OpenRouter API key** – get one at [openrouter.ai](https://openrouter.ai) (sign in, create a key under Keys/API Keys). You will enter it in the app after starting it.

---

## Download and run locally

### 1. Clone or download the repo

```bash
git clone https://github.com/zzish/llm-quiz-generation-evaluator.git
cd llm-quiz-generation-evaluator
```

If you don’t use Git, download the repo as a ZIP from [the repo](https://github.com/zzish/llm-quiz-generation-evaluator) and extract it, then open a terminal in the project folder.

### 2. Install dependencies

```bash
npm install
```

### 3. Start the development server

```bash
npm run dev
```

The app will be available at **http://localhost:5173** (or the port Vite prints). Open that URL in your browser.

To open the app in your browser automatically:

```bash
npm run dev -- --open
```

### 4. Enter your OpenRouter API key

On first use, the app will prompt you for an OpenRouter API key. Enter the key you created at [openrouter.ai](https://openrouter.ai). The key is kept in your browser session and sent with each API request; it is not stored on the server. You can change or clear it later from the UI.

### 5. Run an evaluation

1. Enter a **learning objective** (e.g. `CCSS.MATH.CONTENT.3.OA.A.1`) and a **request** (e.g. `10 question quiz covering different aspects of this learning objective`).
2. Select one or more **test models** and one or more **judge models**.
3. Optionally adjust runs per model, temperature, concurrency, and spacing.
4. Click **Run analysis**. The app will generate quizzes, run judges, and show results in the table.
5. Use **Past runs** to save and manage runs, and **Compare runs** (from Past runs) to compare multiple saved runs side-by-side.

---

## Batch runner (command line)

For measurements larger than a browser session: candidate models write quizzes for a suite of requests, a
panel of judge models scores every quiz with the app's own judge prompt and parser, and the results are
summarised. Calls go straight to each provider (Anthropic, Azure AI Foundry, Google, Meta, Inception,
DeepSeek), using the keys in `.env` (see [Environment](#environment)).

```bash
npm run eval -- models                                                     # every callable model and its reasoning levels
npm run eval -- generate  --suite SUITE.json --config CONFIG.json --out DIR [--runs N] [--only ids] [--max-cost USD]
npm run eval -- import    --suite SUITE.json --from QUIZZES.jsonl --out DIR  # quizzes written by another pipeline
npm run eval -- judge     --config CONFIG.json --out DIR [--quiz-keys FILE] [--max-cost USD]
npm run eval -- summarize --out DIR                                        # writes summary.json and summary.md
```

- **Suite** – the requests (learning objective, request text, tags; optionally an openly licensed source
  passage). **Config** – the candidates and judges, each a model from `npm run eval -- models` with a reasoning
  level; a judge marked `"batch": true` on Claude goes through the Message Batches API at half price. Examples
  are in `scripts/eval/examples/`.
- **DIR** collects `generations.jsonl`, `judgments.jsonl`, `batches.json` and the summary. Keep it outside the
  repository: it holds prompts and quizzes. Every step skips work already recorded there, so a stopped run
  continues where it left off; `--retry-errors` retries only the failed calls.
- **Cost** – each call is priced at list price as it lands; `--max-cost` stops a step once that much has been
  spent. An unknown model or a reasoning level it does not accept stops the step with an error that lists the
  allowed values; a model whose key is missing is recorded as failed, naming the key, without sending anything.
- `--quiz-keys` limits a judge step to the quizzes listed in a file (one key per line), for example to send
  disputed quizzes to a tie-breaking judge.

---

## Scripts

| Command           | Description                          |
|-------------------|--------------------------------------|
| `npm run dev`     | Start dev server (default port 5173) |
| `npm run build`   | Build for production                 |
| `npm run preview` | Preview production build locally     |
| `npm run check`   | Run Svelte and TypeScript checks     |
| `npm run lint`    | ESLint                               |
| `npm test`        | Unit tests (Node's test runner)      |
| `npm run eval`    | The batch runner (see above)         |

---

## Environment

**Batch runner:** copy `.env.example` to `.env` and fill in the keys of the providers your run's config uses
(`ANTHROPIC_API_KEY`, `AZURE_BASE_URL` + `AZURE_API_KEY`, `GEMINI_API_KEY`, `META_MODEL_API_KEY`,
`INCEPTION_API_KEY`, `DEEPSEEK_API_KEY`). `npm run eval` reads `.env` itself; the web app does not use these.

**Web app (optional):** the app gets the OpenRouter API key from the browser (you enter it in the UI). If you want to use a key from the server environment (e.g. for a deployed instance), you can add a `.env` file:

1. Copy the example:  
   `cp .env.example .env`
2. Set your key in `.env`:  
   `OPENROUTER_API_KEY=your_key_here`

The current API routes (`/api/test`, `/api/judge`, `/api/models`, `/api/key`) use the key from the request `Authorization` header when the client sends it. The `.env` file is optional and can be used by your own server-side logic or future features.

Do not commit `.env` or real keys; `.env` is listed in `.gitignore`.

---

## Tech stack

- **SvelteKit 3** – Frontend and API routes  
- **Svelte 5** – UI (runes, `$state`, `$derived`)  
- **TypeScript 6** – Typing throughout  
- **Vite 8** – Build and dev server  
- **OpenRouter** – Single API for multiple LLM providers (the web app's quiz generation and judging)  
- **Anthropic and OpenAI SDKs** – The batch runner's direct calls (the OpenAI SDK also serves Azure, Meta, Inception and DeepSeek)  
- **IndexedDB** (via the browser) – Local storage for saved runs and user-added models  

---

## Project structure

```
llm-evaluator/
├── src/
│   ├── lib/
│   │   ├── config/          # Model catalog, constants
│   │   ├── db/              # IndexedDB: runs, user models
│   │   ├── prompts/         # Generation, judge, enrichment templates
│   │   ├── schemas/         # Quiz JSON schema
│   │   ├── server/          # OpenRouter chat client; providers/ for the batch runner's direct calls
│   │   ├── types/           # Shared types
│   │   ├── validation/     # Quiz and judge response parsing
│   │   └── run-aggregates.ts
│   └── routes/
│       ├── +layout.svelte   # App shell, nav
│       ├── +page.svelte     # Main evaluator UI
│       ├── compare-runs/    # Compare saved runs
│       ├── runs/            # Past runs list
│       ├── api/             # test, judge, models, key
│       ├── faq/
│       ├── learn-more/
│       └── openrouter/      # API key / OpenRouter info
├── scripts/eval/            # Batch runner: run.ts, lib/, examples/
├── static/
├── package.json
├── vite.config.ts           # Vite and SvelteKit configuration (adapter included)
└── tsconfig.json
```

---

## Building for production

```bash
npm run build
```

Output is in `build/` (or your adapter’s output directory). To run the production build locally:

```bash
npm run preview
```

For deployment, use the [SvelteKit adapter](https://svelte.dev/docs/kit/adapters) that matches your host (e.g. `@sveltejs/adapter-node`, `adapter-static`, or adapter-auto’s detection). The adapter is set in `vite.config.ts`, where SvelteKit 3 reads its configuration.

---

## License

Private / unlicensed unless otherwise specified. Check the repo for a LICENSE file.
