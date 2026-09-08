import { NextRequest, NextResponse } from "next/server";
import { getSandbox, runDirFor } from "@/lib/sandbox-orchestrator";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const runId = req.nextUrl.searchParams.get("runId");
  if (!runId) {
    return NextResponse.json({ error: "Missing runId" }, { status: 400 });
  }

  try {
    const sandbox = await getSandbox();
    const buf = await sandbox.readFileToBuffer({ path: `${runDirFor(runId)}/status.json` });
    if (!buf) {
      return NextResponse.json({ status: "unknown" });
    }
    const status = JSON.parse(buf.toString("utf8"));
    return NextResponse.json(status);
  } catch (err: any) {
    return NextResponse.json({ error: `Could not check status: ${String(err?.message || err).slice(-500)}` }, { status: 500 });
  }
}
