// In-memory variant of the synthetic-usability-test engine, adapted for a
// serverless request/response cycle: no file writes (a Vercel Function has
// no persistent disk), no Tier-2/cursor-realism (kept out of the hosted
// MVP to minimize dependencies and cost — see the skill's CLI version at
// github.com/ChristoKurian/Synthetic-User-Test for those). The core
// per-step logic (element collection, information-scent scoring,
// considerationSpan, criteria checking) is unchanged from the CLI engine.
//
// The browser itself is injected via `launchBrowser()` so this same file
// works with a local full Playwright install (dev) or playwright-core +
// @sparticuz/chromium (Vercel Functions) without caring which.

import { buildPersonaRoster } from "./personas.mjs";
import { scoreElement, weightedPick, extractKeywords } from "./scent.mjs";

async function collectInteractiveElements(page, scopePrefix) {
  return page.evaluate((scopePrefix) => {
    const SELECTOR =
      "a[href], button, [role=button], [role=link], [role=menuitem], " +
      "input:not([type=hidden]):not([disabled]), select, textarea, summary, [onclick]";
    const semanticNodes = Array.from(document.querySelectorAll(SELECTOR));
    const cursorCandidateNodes = Array.from(document.querySelectorAll("div, span, tr, td, li, article, section")).filter(
      (el) => window.getComputedStyle(el).cursor === "pointer"
    );
    const nodes = [...semanticNodes, ...cursorCandidateNodes];
    const seen = new Set();
    const out = [];
    let idx = 0;
    const prefixWithSlash = scopePrefix.endsWith("/") ? scopePrefix : scopePrefix + "/";
    const inScope = (pathname) => pathname === scopePrefix || pathname.startsWith(prefixWithSlash);

    function nearbyContextText(el) {
      if (el.id) {
        const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lbl && lbl.innerText && lbl.innerText.trim()) return lbl.innerText.trim().slice(0, 120);
      }
      const wrappingLabel = el.closest("label");
      if (wrappingLabel && wrappingLabel.innerText && wrappingLabel.innerText.trim()) {
        return wrappingLabel.innerText.trim().slice(0, 120);
      }
      const row = el.closest('li, tr, [role="listitem"], [role="row"]');
      if (row && row.innerText && row.innerText.trim()) return row.innerText.trim().slice(0, 120);
      return "";
    }

    for (const el of nodes) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const visible = rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      if (!visible) continue;

      const tag = el.tagName.toLowerCase();
      const text = (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().slice(0, 120);
      const placeholder = el.getAttribute("placeholder") || "";
      if (!text && !placeholder && !["input", "select", "textarea"].includes(tag)) continue;

      if (tag === "a") {
        const href = el.getAttribute("href") || "";
        if (href && !href.startsWith("#") && !href.startsWith("javascript:")) {
          try {
            const resolved = new URL(href, location.href);
            if (resolved.hostname !== location.hostname || !inScope(resolved.pathname)) continue;
          } catch {
            /* relative or unparsable href — treat as in-scope */
          }
        }
      }

      const key = tag + "|" + text + "|" + Math.round(rect.top) + "|" + Math.round(rect.left);
      if (seen.has(key)) continue;
      seen.add(key);

      const type = el.getAttribute("type") || "";
      const needsContext = !text && !placeholder && (tag === "input" ? ["checkbox", "radio"].includes(type) : true);

      el.setAttribute("data-suid", String(idx));
      out.push({
        suid: idx,
        text,
        aria: el.getAttribute("aria-label") || "",
        placeholder,
        context: needsContext ? nearbyContextText(el) : "",
        name: el.getAttribute("name") || "",
        title: el.getAttribute("title") || "",
        tag,
        role: el.getAttribute("role") || "",
        type,
        readonly: el.hasAttribute("readonly"),
        href: el.getAttribute("href") || "",
        index: idx,
        y: Math.round(rect.top + window.scrollY),
      });
      idx++;
    }
    return out;
  }, scopePrefix);
}

async function detectAuthWall(page) {
  return page.locator("input[type=password]").first().isVisible().catch(() => false);
}

function actionSequenceMatched(actionHistory, keywords) {
  let i = 0;
  for (const text of actionHistory) {
    if (i >= keywords.length) break;
    if (text.includes(String(keywords[i]).toLowerCase())) i++;
  }
  return i >= keywords.length;
}

async function checkCriteria(page, criteria, actionHistory = []) {
  if (!criteria || !criteria.length) return null;
  const url = page.url();
  for (const c of criteria) {
    try {
      if (c.type === "urlContains" && url.includes(c.value)) return c;
      if (c.type === "urlMatches" && new RegExp(c.value).test(url)) return c;
      if (c.type === "actionSequence" && actionSequenceMatched(actionHistory, c.value)) return c;
      if (c.type === "textVisible") {
        const found = await page.getByText(c.value, { exact: false }).first().isVisible({ timeout: 500 }).catch(() => false);
        if (found) return c;
      }
      if (c.type === "selectorVisible") {
        const found = await page.locator(c.value).first().isVisible({ timeout: 500 }).catch(() => false);
        if (found) return c;
      }
      if (c.type === "selectorHidden") {
        const found = await page.locator(c.value).first().isVisible({ timeout: 500 }).catch(() => false);
        if (!found) return c;
      }
    } catch {
      /* best-effort */
    }
  }
  return null;
}

function fakeValueFor(el, task) {
  const label = (el.placeholder || el.aria || el.name || "").toLowerCase();
  if (label.includes("email")) return "synthetic.user+test@example.com";
  if (label.includes("search")) return (task.keywords && task.keywords[0]) || task.description?.split(" ").slice(0, 2).join(" ") || "test";
  if (el.type === "number") return String(Math.floor(Math.random() * 100) + 1);
  if (el.tag === "textarea") return "Synthetic usability-test session — auto-generated input.";
  return (task.keywords && task.keywords[0]) || "Test";
}

async function runSession({ browser, variant, task, persona, maxDurationMs }) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: `SyntheticUsabilityTest/1.0 (${persona.archetype})`,
  });
  const page = await context.newPage();
  const sessionId = `${persona.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const scopePrefix = new URL(variant.url).pathname;
  const start = Date.now();
  const keywords = extractKeywords(task);
  const events = [];
  const history = [];
  const actionTextHistory = [];
  const usedCounts = new Map();
  let step = 0;
  let outcome = "abandoned";
  let lastTargetSuid = null;
  let lastClickTime = 0;
  let rageStreak = 0;
  let visitedNonHome = false;

  const targetKey = (el) => `${el.tag}|${el.text}|${el.placeholder}|${el.name}`;
  const log = (event, extra = {}) =>
    events.push({ ts: new Date().toISOString(), tMs: Date.now() - start, sessionId, personaId: persona.id, personaArchetype: persona.archetype, step, event, pageUrl: page.url(), target: null, meta: {}, ...extra });

  try {
    await page.goto(variant.url, { waitUntil: "domcontentloaded", timeout: 20000 });
    log("session_start");

    if (await detectAuthWall(page)) {
      log("auth_wall_detected");
      outcome = "blocked";
      await context.close();
      return { sessionId, outcome, steps: step, durationMs: Date.now() - start, events };
    }

    while (step < persona.params.patienceSteps && Date.now() - start < maxDurationMs) {
      step++;

      const matched = await checkCriteria(page, task.successCriteria, actionTextHistory);
      if (matched) {
        log("task_completed", { meta: { matched } });
        outcome = "success";
        break;
      }
      const failedMatch = await checkCriteria(page, task.failureCriteria, actionTextHistory);
      if (failedMatch) {
        log("task_failed", { meta: { matched: failedMatch } });
        outcome = "failed";
        break;
      }

      if (step % 3 === 0) {
        await page.mouse.wheel(0, 400 + Math.random() * 400).catch(() => {});
      }

      const elements = await collectInteractiveElements(page, scopePrefix);
      if (!elements.length) {
        log("dead_end", { meta: { reason: "no_interactive_elements" } });
        outcome = "abandoned";
        break;
      }

      const scores = elements.map((el) => {
        const raw = scoreElement(el, keywords);
        const used = usedCounts.get(targetKey(el)) || 0;
        return raw * Math.pow(0.35, used);
      });

      let pick;
      if (Math.random() < persona.params.noiseClickProb) {
        const idx = Math.floor(Math.random() * elements.length);
        pick = { item: elements[idx], score: scores[idx] };
      } else {
        const ranked = elements
          .map((e, i) => ({ e, s: scores[i] }))
          .sort((a, b) => b.s - a.s)
          .slice(0, Math.max(1, persona.params.considerationSpan || elements.length));
        if (Math.random() < persona.params.misclickProb) {
          const midPool = ranked.slice(Math.floor(ranked.length * 0.3), Math.floor(ranked.length * 0.7));
          const choice = midPool[Math.floor(Math.random() * midPool.length)] || ranked[0];
          pick = { item: choice.e, score: choice.s };
        } else {
          pick = weightedPick(ranked.map((r) => r.e), ranked.map((r) => r.s), persona.params.temperature);
        }
      }
      if (!pick) {
        outcome = "abandoned";
        break;
      }

      const target = pick.item;
      const [dMin, dMax] = persona.params.dwellMsRange;
      const dwell = (dMin + Math.random() * (dMax - dMin)) * persona.params.readingSpeedFactor;
      await page.waitForTimeout(Math.min(dwell, 3000));

      const locator = page.locator(`[data-suid="${target.suid}"]`).first();
      try {
        const isTextInput = ["input", "textarea"].includes(target.tag) && !target.readonly && !["checkbox", "radio", "submit", "button"].includes(target.type);
        if (isTextInput) {
          if (target.type === "password") {
            log("auth_wall_detected", { target });
            outcome = "blocked";
            break;
          }
          await locator.fill(fakeValueFor(target, task), { timeout: 5000 });
          log("type", { target, scentScore: pick.score });
          const singleLine = target.tag === "input" && ["text", "search", "email", "tel", "url", ""].includes(target.type);
          if (singleLine && Math.random() < 0.7) {
            await locator.press("Enter", { timeout: 3000 }).catch(() => {});
          }
        } else {
          try {
            await locator.click({ timeout: 4000 });
          } catch {
            await locator.click({ timeout: 3000, force: true });
          }
          log("click", { target, scentScore: pick.score });
        }
      } catch (err) {
        log("error", { target, meta: { message: String(err).slice(0, 200) } });
        continue;
      }

      usedCounts.set(targetKey(target), (usedCounts.get(targetKey(target)) || 0) + 1);
      actionTextHistory.push((target.text || target.aria || target.placeholder || "").toLowerCase());
      if (page.url() !== variant.url) visitedNonHome = true;

      const now = Date.now();
      if (lastTargetSuid === target.suid && now - lastClickTime < 2500) {
        rageStreak++;
        if (rageStreak >= 2) log("rage_click", { target });
      } else {
        rageStreak = 0;
      }
      lastTargetSuid = target.suid;
      lastClickTime = now;

      const url = page.url();
      history.push(url);
      if (history.length > 6) history.shift();
      if (history.filter((u) => u === url).length >= 3) log("backtrack_loop", { meta: { url } });

      if (visitedNonHome && Math.random() < persona.params.backtrackProb) {
        await page.goBack({ waitUntil: "domcontentloaded", timeout: 5000 }).catch(() => {});
        log("backtrack");
        visitedNonHome = false;
      }
    }

    if (outcome === "abandoned") {
      const reason = Date.now() - start >= maxDurationMs ? "timeout" : "patience_exhausted";
      log("task_abandoned", { meta: { reason } });
    }
  } catch (err) {
    log("error", { meta: { message: String(err).slice(0, 300), fatal: true } });
  } finally {
    log("session_end", { meta: { outcome } });
    await context.close();
  }

  return { sessionId, outcome, steps: step, durationMs: Date.now() - start, events };
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let i = 0;
  async function next() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
  return results;
}

// launchBrowser: () => Promise<Browser> — caller decides local Playwright
// vs. playwright-core + @sparticuz/chromium.
export async function runComparison({ variants, task, personas, concurrency = 5, maxDurationMs = 60000, launchBrowser, onProgress = () => {} }) {
  const browser = await launchBrowser();
  const variantResults = {};
  try {
    for (const variant of variants) {
      const roster = buildPersonaRoster(personas, personas?.count || 10);
      onProgress?.({ type: "variant_start", variant: variant.name, sessionCount: roster.length });
      const results = await runWithConcurrency(roster, concurrency, async (persona) => {
        await new Promise((r) => setTimeout(r, Math.random() * 800));
        return runSession({ browser, variant, task, persona, maxDurationMs });
      });
      const outcomes = results.reduce((acc, r) => ((acc[r.outcome] = (acc[r.outcome] || 0) + 1), acc), {});
      variantResults[variant.name] = { url: variant.url, results, outcomes };
      onProgress?.({ type: "variant_done", variant: variant.name, outcomes });
    }
  } finally {
    await browser.close();
  }
  return variantResults;
}
