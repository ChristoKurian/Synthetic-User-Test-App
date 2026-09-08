import { NextRequest, NextResponse } from "next/server";
// @ts-ignore -- plain JS engine modules, not typed
import { runComparison } from "@/lib/engine/engine.mjs";
// @ts-ignore
import { launchBrowser } from "@/lib/engine/launch-browser.mjs";
// @ts-ignore
import { buildReportData, renderReportHtml } from "@/lib/engine/report.mjs";
// @ts-ignore
import { parsePersonaText } from "@/lib/engine/parse-persona-text.mjs";

export const maxDuration = 300; // Vercel Functions: extended timeout for a real multi-session run
export const dynamic = "force-dynamic";

// Keep the hosted default modest — this runs synchronously inside one
// request, so it has to fit inside maxDuration with real margin. Bigger
// sweeps belong to the CLI skill (github.com/ChristoKurian/Synthetic-User-Test),
// which has no such ceiling.
const PERSONA_COUNT_PER_VARIANT = 2;
// Verified against the real deployed function: @sparticuz/chromium's
// `--single-process` Chromium (required to fit Vercel's serverless sandbox)
// shares one OS process across every context — concurrency 2+ reliably
// crashed the whole browser mid-run in live testing, concurrency 1 did
// not. Running fully sequential is the safe default until sessions are
// isolated into separate browser instances (see README) rather than
// shared contexts within one process.
const CONCURRENCY = 1;
const MAX_SESSION_DURATION_MS = 20000;

function isPlausibleUrl(u: string) {
  try {
    const parsed = new URL(u);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const urls = ["url1", "url2", "url3"]
    .map((k) => (form.get(k) as string | null)?.trim())
    .filter((u): u is string => Boolean(u));
  const goal = ((form.get("goal") as string) || "").trim();
  const successSignal = ((form.get("successSignal") as string) || "").trim();
  const personaFile = form.get("personaFile") as File | null;

  if (urls.length < 1) {
    return NextResponse.json({ error: "Provide at least one prototype URL." }, { status: 400 });
  }
  for (const u of urls) {
    if (!isPlausibleUrl(u)) {
      return NextResponse.json({ error: `"${u}" doesn't look like a valid http(s) URL.` }, { status: 400 });
    }
  }
  if (!goal) {
    return NextResponse.json({ error: "Describe what the synthetic users are trying to accomplish." }, { status: 400 });
  }

  let personaText = "";
  if (personaFile && personaFile.size > 0) {
    personaText = await personaFile.text();
  }
  const parsedPersona = parsePersonaText(personaText);

  const variants = urls.map((url, i) => ({ name: `v${i + 1}`, url }));

  const task: any = {
    description: goal,
    successCriteria: successSignal ? [{ type: "textVisible", value: successSignal }] : [],
  };

  const personas: any = parsedPersona
    ? { mix: [{ name: "described_users", traits: parsedPersona.traits, count: PERSONA_COUNT_PER_VARIANT }] }
    : { count: PERSONA_COUNT_PER_VARIANT };

  try {
    const variantResults = await runComparison({
      variants,
      task,
      personas,
      concurrency: CONCURRENCY,
      maxDurationMs: MAX_SESSION_DURATION_MS,
      launchBrowser,
    });

    const stats = buildReportData(variantResults);
    const title = `Comparison: ${variants.map((v: any) => v.name).join(" vs ")}`;
    const reportHtml = renderReportHtml(title, stats);

    return NextResponse.json({
      reportHtml,
      stats,
      usedFallbackSuccessSignal: !successSignal,
      personaSignals: parsedPersona?.matchedSignals || null,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Run failed: ${String(err?.message || err).slice(-500)}` },
      { status: 500 }
    );
  }
}
