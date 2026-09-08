// Entrypoint that runs INSIDE the Vercel Sandbox VM (not in the calling
// Vercel Function). Writes progressive status to status.json so the
// Function can poll it across separate invocations rather than holding a
// live connection open — a real multi-session run can easily take longer
// than a single request should block for.
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { runComparison } from "./engine.mjs";
import { buildReportData, renderReportHtml } from "./report.mjs";

const runDir = process.argv[2];
if (!runDir) {
  console.error("Usage: node run.mjs <runDir>");
  process.exit(1);
}

const statusPath = `${runDir}/status.json`;
const writeStatus = (s) => writeFileSync(statusPath, JSON.stringify(s));

async function main() {
  const config = JSON.parse(readFileSync(`${runDir}/config.json`, "utf8"));
  writeStatus({ status: "running", startedAt: Date.now() });

  const variantResults = await runComparison({
    ...config,
    launchBrowser: () => chromium.launch({ headless: true }),
    onProgress: (evt) => {
      writeStatus({ status: "running", startedAt: Date.now(), progress: evt });
    },
  });

  const stats = buildReportData(variantResults);
  const title = `Comparison: ${config.variants.map((v) => v.name).join(" vs ")}`;
  const reportHtml = renderReportHtml(title, stats);

  writeStatus({
    status: "done",
    doneAt: Date.now(),
    reportHtml,
    stats,
  });
}

main().catch((err) => {
  writeStatus({ status: "error", error: String(err?.message || err).slice(0, 1000) });
  process.exit(1);
});
