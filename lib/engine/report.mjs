// Same aggregation/rendering as the CLI skill's generate-report.mjs,
// adapted to work directly on runComparison()'s in-memory result object
// instead of reading JSONL files off disk (a Vercel Function has no
// persistent disk to read back from).

function summarizeSession(events) {
  const end = events.find((e) => e.event === "session_end");
  const outcome =
    end?.meta?.outcome ||
    (events.find((e) => e.event === "task_completed") && "success") ||
    (events.find((e) => e.event === "task_failed") && "failed") ||
    (events.find((e) => e.event === "auth_wall_detected") && "blocked") ||
    "abandoned";
  return {
    outcome,
    steps: Math.max(0, ...events.map((e) => e.step || 0)),
    durationMs: Math.max(0, ...events.map((e) => e.tMs || 0)),
    clicks: events.filter((e) => e.event === "click").length,
    errors: events.filter((e) => e.event === "error").length,
    rageClicks: events.filter((e) => e.event === "rage_click").length,
    backtrackLoops: events.filter((e) => e.event === "backtrack_loop").length,
  };
}

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function aggregate(sessions, personaArchetypes) {
  const n = sessions.length;
  const successes = sessions.filter((s) => s.outcome === "success");
  const byArchetype = {};
  sessions.forEach((s, i) => {
    const arch = personaArchetypes[i];
    byArchetype[arch] ??= { n: 0, success: 0 };
    byArchetype[arch].n++;
    if (s.outcome === "success") byArchetype[arch].success++;
  });
  return {
    n,
    successRate: n ? successes.length / n : 0,
    medianTimeToSuccessMs: median(successes.map((s) => s.durationMs)),
    medianClicks: median(sessions.map((s) => s.clicks)),
    errorRate: n ? sessions.reduce((a, s) => a + s.errors, 0) / n : 0,
    rageClickSessions: sessions.filter((s) => s.rageClicks > 0).length,
    backtrackLoopSessions: sessions.filter((s) => s.backtrackLoops > 0).length,
    byArchetype,
  };
}

function fmtMs(ms) {
  if (!ms) return "—";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}
const pct = (x) => `${Math.round(x * 100)}%`;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const PALETTE = ["#6d28d9", "#0ea5e9", "#16a34a", "#ea580c", "#db2777", "#64748b"];

export function buildReportData(variantResults) {
  const stats = {};
  for (const [name, v] of Object.entries(variantResults)) {
    const sessions = v.results.map((r) => summarizeSession(r.events));
    const archetypes = v.results.map((r) => r.events[0]?.personaArchetype || "unknown");
    stats[name] = { url: v.url, ...aggregate(sessions, archetypes) };
  }
  return stats;
}

export function renderReportHtml(title, stats) {
  const names = Object.keys(stats);
  const maxSuccessRate = Math.max(0.0001, ...names.map((n) => stats[n].successRate));
  const maxClicks = Math.max(1, ...names.map((n) => stats[n].medianClicks));

  const bar = (value, max, color) => {
    const w = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
    return `<div class="bar-track"><div class="bar-fill" style="width:${w}%;background:${color}"></div></div>`;
  };

  const rows = names
    .map((name, i) => {
      const s = stats[name];
      const color = PALETTE[i % PALETTE.length];
      return `<tr>
        <td><span class="dot" style="background:${color}"></span>${esc(name)}</td>
        <td class="num">${s.n}</td>
        <td>${bar(s.successRate, maxSuccessRate, color)}<span class="num-label">${pct(s.successRate)}</span></td>
        <td class="num">${fmtMs(s.medianTimeToSuccessMs)}</td>
        <td>${bar(s.medianClicks, maxClicks, color)}<span class="num-label">${s.medianClicks.toFixed(1)}</span></td>
        <td class="num">${s.errorRate.toFixed(2)}</td>
        <td class="num">${s.rageClickSessions}</td>
        <td class="num">${s.backtrackLoopSessions}</td>
      </tr>`;
    })
    .join("");

  const archetypeRows = names
    .flatMap((name) =>
      Object.entries(stats[name].byArchetype).map(
        ([arch, a]) => `<tr><td>${esc(name)}</td><td>${esc(arch)}</td><td class="num">${a.n}</td><td class="num">${pct(a.n ? a.success / a.n : 0)}</td></tr>`
      )
    )
    .join("");

  const best = names.reduce((a, b) => (stats[a].successRate >= stats[b].successRate ? a : b), names[0]);
  const bestStats = stats[best];

  return `<!doctype html><html><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root{ --paper:#faf9fc; --ink:#170a2e; --ink-muted:#5b5470; --ink-faint:#948da2; --line:#e6e3ec; --raised:#fff; --accent:#6d28d9; --accent-soft:#ede7fb; }
  @media (prefers-color-scheme: dark){ :root{ --paper:#170a2e; --ink:#f4f1fa; --ink-muted:#c3bcd6; --ink-faint:#948da2; --line:#3a2d5c; --raised:#20103f; --accent:#a78bfa; --accent-soft:#341a63; } }
  *{box-sizing:border-box}
  body{ margin:0; background:var(--paper); color:var(--ink); font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; padding:32px 20px 64px; }
  .wrap{ max-width:920px; margin:0 auto; }
  h1{ font-size:22px; margin:0 0 6px; }
  .sub{ color:var(--ink-muted); margin:0 0 24px; font-size:13px; }
  .callout{ background:var(--accent-soft); border-left:3px solid var(--accent); border-radius:8px; padding:14px 18px; margin:0 0 28px; font-size:14px; }
  h2{ font-size:15px; margin:28px 0 10px; }
  table{ width:100%; border-collapse:collapse; font-size:13px; background:var(--raised); border:1px solid var(--line); border-radius:8px; overflow:hidden; }
  th{ text-align:left; font-size:10.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-faint); padding:10px 12px; border-bottom:1px solid var(--line); }
  td{ padding:10px 12px; border-bottom:1px solid var(--line); vertical-align:middle; }
  tr:last-child td{ border-bottom:none; }
  td.num{ text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .dot{ display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:8px; }
  .bar-track{ display:inline-block; width:70px; height:6px; background:var(--line); border-radius:4px; vertical-align:middle; margin-right:8px; overflow:hidden; }
  .bar-fill{ height:100%; border-radius:4px; }
  .num-label{ font-variant-numeric:tabular-nums; font-size:12px; color:var(--ink-muted); }
</style></head><body><div class="wrap">
  <h1>${esc(title)}</h1>
  <p class="sub">Generated ${new Date().toISOString()}</p>
  <div class="callout"><strong>${esc(best)}</strong> had the highest task success rate (${pct(bestStats.successRate)} of ${bestStats.n} synthetic sessions), median time-to-success ${fmtMs(bestStats.medianTimeToSuccessMs)}.</div>
  <h2>Variant comparison</h2>
  <div style="overflow-x:auto"><table>
    <thead><tr><th>Variant</th><th>Sessions</th><th>Success rate</th><th>Median time-to-success</th><th>Median clicks</th><th>Errors/session</th><th>Rage-click</th><th>Backtrack loop</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
  <h2>Success rate by persona archetype</h2>
  <div style="overflow-x:auto"><table>
    <thead><tr><th>Variant</th><th>Archetype</th><th>Sessions</th><th>Success rate</th></tr></thead>
    <tbody>${archetypeRows}</tbody>
  </table></div>
</div></body></html>`;
}
