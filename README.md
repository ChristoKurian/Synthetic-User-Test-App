# Synthetic Usability Test — Web App

A hosted, no-terminal-required version of [synthetic-usability-test](https://github.com/ChristoKurian/Synthetic-User-Test) (the Claude Code skill this project also ships): paste two or three live prototype URLs, describe the goal, optionally describe your users, click **Run Test**, and get a comparison report — synthetic personas with varying behavior (attention, tech savviness, dexterity, patience, language fluency) drive real headless-browser sessions against each prototype and measure task success, time, clicks, and friction signals (errors, rage-clicks, dead ends).

Built with Next.js (App Router) + Tailwind + shadcn/ui, deployed on Vercel.

## ⚠️ Current status: not yet reliable in production

The core pipeline is proven — clean successful runs both locally and on a live Vercel deployment during development. But the deployed API has since shown intermittent hangs (timing out at the full 300s function limit with no clear error) under the same conditions that worked moments earlier. Likely cause: `@sparticuz/chromium`'s `--single-process` Chromium mode is fragile under concurrent load in this sandbox — concurrency ≥2 reliably crashed the browser outright in testing, and even fully sequential (concurrency 1) execution has since become inconsistent.

**Known-good, verified locally:** `npm run dev` — the full form → API → engine → report pipeline works reliably every time.

**Not yet resolved:** consistent reliability on the deployed Vercel Function. The likely real fix is moving this workload off a standard Function (request/response, hard timeout) onto **Vercel Sandbox**, which is built for longer-running, heavier processes like a real headless-browser session — that rewrite hasn't been done yet.

If you're picking this up: start by reading the git history / commit messages for the debugging trail (module tracing, memory limits, concurrency crashes), then either retry the current Function-based approach after confirming Hobby-plan resource limits aren't the bottleneck, or do the Sandbox rewrite.

## Local development

```bash
npm install
npx playwright install chromium   # local dev only — production uses @sparticuz/chromium instead
npm run dev
```

## Architecture

```
app/
  page.tsx              form UI (shadcn)
  api/run/route.ts       POST handler: builds a config, runs the engine, returns a report
lib/engine/
  engine.mjs             in-memory variant of the CLI skill's engine (no file I/O — a
                          Vercel Function has no persistent disk)
  launch-browser.mjs      env-aware: playwright (local) vs playwright-core + @sparticuz/chromium (Vercel)
  personas.mjs, scent.mjs copied unchanged from the CLI skill (engine-agnostic)
  parse-persona-text.mjs  deterministic (no LLM) keyword mapping from a persona description to traits
  report.mjs              same report rendering as the CLI skill's generate-report.mjs
```

Deliberately out of scope for this hosted MVP (present in the CLI skill, not here): Tier-2 LLM-scored engine, cursor realism, PostHog export. Kept minimal to reduce what could go wrong while getting the core loop working.

## Known constraints (current hardcoded values in `app/api/run/route.ts`)

- `CONCURRENCY = 1` — sequential sessions only; see status note above.
- `PERSONA_COUNT_PER_VARIANT = 2` — kept low to fit worst-case runtime inside the 300s function timeout.
- `MAX_SESSION_DURATION_MS = 20000` — per-session budget.

These are conservative by necessity, not by design — the CLI skill's defaults (15-20 personas, real concurrency) are what this *should* converge toward once the reliability issue is resolved.
