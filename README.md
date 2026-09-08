# Synthetic Usability Test — Web App

A hosted, no-terminal-required version of [synthetic-usability-test](https://github.com/ChristoKurian/Synthetic-User-Test) (the Claude Code skill this project also ships): paste two or three live prototype URLs, describe the goal, optionally describe your users, click **Run Test**, and get a comparison report — synthetic personas with varying behavior (attention, tech savviness, dexterity, patience, language fluency) drive real headless-browser sessions against each prototype and measure task success, time, clicks, and friction signals (errors, rage-clicks, dead ends).

Built with Next.js (App Router) + Tailwind + shadcn/ui, deployed on Vercel. Browser automation runs inside **Vercel Sandbox** (a real Linux VM), not a standard Vercel Function — a Function's hard request timeout and its constrained single-process Chromium workaround (`@sparticuz/chromium`) both proved too fragile for a real multi-session browser-automation workload; see "Why Sandbox, not a Function" below.

## Status: working, verified in production

Confirmed end-to-end — locally and against the live deployed URL — with real multi-persona, multi-variant runs completing and rendering correct, differentiated reports (e.g. a real run: variant A 100% success / variant B 50-70% success across a mixed persona set, matching genuinely different task friction, not a fluke).

## How it works

1. **`POST /api/run`** — validates input, resolves (or creates) a shared, named, persistent Sandbox, writes the engine code and this run's config into it, and starts the test **detached** (fire-and-forget from the Function's point of view). Returns a `runId` immediately — this route's own job is just to kick things off, not to wait around.
2. Inside the Sandbox, `run.mjs` runs the actual synthetic sessions using plain `playwright` (real multi-process Chromium — no single-process workaround needed on a real VM) and writes progress to `status.json` as it goes.
3. **`GET /api/status?runId=...`** — reconnects to the same named Sandbox and reads that run's `status.json`. The frontend polls this every few seconds until it reports `done` (with the report) or `error`.

This two-route, poll-based shape exists because a real run (multiple personas × multiple variants, each a real page load) routinely takes longer than any single HTTP request should reasonably stay open for — so nothing in this design waits synchronously for the whole thing to finish.

## Why Sandbox, not a Function

The original version ran Playwright directly inside the Vercel Function using `playwright-core` + `@sparticuz/chromium` (the standard combo for headless Chrome on Lambda-style serverless runtimes). Two real problems surfaced in production testing, not just theory:

- `@sparticuz/chromium` runs Chromium in `--single-process` mode to fit the Function sandbox. Concurrency ≥2 (multiple browser contexts sharing that one process) reliably **crashed the whole browser outright** — verified directly, not inferred.
- Even fully sequential (concurrency 1), a real run's wall-clock time — install/launch overhead plus N real page loads — routinely approached or exceeded the Function's hard timeout, with no way to extend it mid-run.

Moving the actual browser work into a Sandbox VM sidesteps both: a Sandbox is a real (if ephemeral) Linux machine, so normal multi-process Chromium works without the single-process crash mode, and it isn't bound by a single request's timeout — the calling Function only needs to survive long enough to kick the job off and, later, to answer a cheap status check.

## Local development

```bash
npm install
npm run dev
```

Needs Vercel credentials to reach the Sandbox API even locally — `vercel link` (already done in this repo) drops a `VERCEL_OIDC_TOKEN` into `.env.local`, which the SDK picks up automatically. On an actual Vercel deployment this is automatic (no env vars to set).

## Architecture

```
app/
  page.tsx                  form UI (shadcn); POSTs to /api/run, then polls /api/status
  api/run/route.ts           orchestrator: starts a detached run in the Sandbox, returns a runId
  api/status/route.ts        polls one run's status.json inside the Sandbox
lib/
  sandbox-orchestrator.ts    shared Sandbox get-or-create + system/Playwright setup (runs once, reused)
  engine/
    run.mjs                  entrypoint that actually runs INSIDE the Sandbox — launches real
                              Playwright, calls the engine, writes status.json as it goes
    engine.mjs                in-memory variant of the CLI skill's engine (no file writes on the
                              Function side — the Sandbox has its own disk)
    personas.mjs, scent.mjs   copied unchanged from the CLI skill (engine-agnostic)
    parse-persona-text.mjs    deterministic (no LLM) keyword mapping from a persona description to traits
    report.mjs                same report rendering as the CLI skill's generate-report.mjs
```

`lib/engine/*.mjs` are read as raw text (via `fs.readFileSync`) and written into the Sandbox rather than imported — Next's automatic file tracer doesn't see that reference, so `next.config.ts` explicitly includes them via `outputFileTracingIncludes` for both routes. Miss that and the deployed function silently can't find them at runtime.

Deliberately out of scope for this hosted MVP (present in the CLI skill, not here): Tier-2 LLM-scored engine, cursor realism, PostHog export.

## Current defaults (`app/api/run/route.ts`)

- `PERSONA_COUNT_PER_VARIANT = 10`, `CONCURRENCY = 4` — real values now that a Sandbox VM isn't fighting single-process Chromium; not yet pushed as high as the CLI skill's own defaults, mainly to keep individual test runs quick while iterating.
- The shared Sandbox (`resources: { vcpus: 2 }`, 20-minute timeout) is reused across runs rather than provisioned fresh each time — Playwright + Chromium + system deps install once, on first use.
