import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
// @ts-ignore
import { parsePersonaText } from "@/lib/engine/parse-persona-text.mjs";
import { getSandbox, writeEngineFiles, runDirFor } from "@/lib/sandbox-orchestrator";

export const maxDuration = 60; // this route only orchestrates — writes files and starts a detached
// process in the sandbox, then returns. The actual test run happens in the
// sandbox independently of this Function's lifetime; see app/api/status.
export const dynamic = "force-dynamic";

// Real concurrency and a real persona count are back on the table — the
// sandbox is a full multi-vCPU Linux VM running normal multi-process
// Chromium, not the constrained single-process serverless-Function
// workaround that crashed under any concurrency >1.
const PERSONA_COUNT_PER_VARIANT = 10;
const CONCURRENCY = 4;
const MAX_SESSION_DURATION_MS = 45000;

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

  const config = {
    variants,
    task,
    personas,
    concurrency: CONCURRENCY,
    maxDurationMs: MAX_SESSION_DURATION_MS,
  };

  try {
    const runId = randomUUID();
    const sandbox = await getSandbox();
    const dir = runDirFor(runId);
    await sandbox.runCommand({ cmd: "mkdir", args: ["-p", dir] });
    await writeEngineFiles(sandbox);
    await sandbox.writeFiles([
      { path: `${dir}/config.json`, content: JSON.stringify(config) },
      { path: `${dir}/status.json`, content: JSON.stringify({ status: "queued" }) },
    ]);
    // Detached: this Function does not wait for the run to finish. The
    // sandbox keeps executing after this request returns; app/api/status
    // polls status.json to find out when it's done.
    await sandbox.runCommand({
      cmd: "node",
      args: ["/vercel/sandbox/engine/run.mjs", dir],
      detached: true,
    });

    return NextResponse.json({
      runId,
      usedFallbackSuccessSignal: !successSignal,
      personaSignals: parsedPersona?.matchedSignals || null,
    });
  } catch (err: any) {
    return NextResponse.json({ error: `Could not start the run: ${String(err?.message || err).slice(-500)}` }, { status: 500 });
  }
}
