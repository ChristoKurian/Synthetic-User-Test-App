// Local dev: a full Playwright install with its own downloaded Chromium.
// Vercel Functions: playwright-core (no bundled browser) + @sparticuz/chromium
// (a Lambda/serverless-optimized Chromium binary) — the standard combo for
// running headless Chrome inside a Vercel/AWS Lambda-style function, since
// a normal Playwright browser download doesn't fit the sandboxed runtime.
export async function launchBrowser() {
  if (process.env.VERCEL) {
    const [{ default: chromium }, { chromium: pwChromium }] = await Promise.all([
      import("@sparticuz/chromium"),
      import("playwright-core"),
    ]);
    return pwChromium.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }
  const { chromium } = await import("playwright");
  return chromium.launch({ headless: true });
}
