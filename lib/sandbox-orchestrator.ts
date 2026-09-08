import { Sandbox } from "@vercel/sandbox";
import { readFileSync } from "node:fs";
import path from "node:path";

// One shared, persistent, named sandbox reused across every run rather than
// a fresh VM per request — Playwright + Chromium + system deps get
// installed once (onCreate), not on every single test run. Multi-tenant on
// one VM is fine for a single-operator tool; each run gets its own
// subdirectory under /vercel/sandbox/runs so concurrent runs don't clobber
// each other's state.
const SANDBOX_NAME = "synthetic-usability-runner";
const SANDBOX_TIMEOUT_MS = 20 * 60_000;

// System libraries Chromium needs on the sandbox VM (Amazon Linux / dnf) —
// same list Vercel documents for running headless Chrome in a Sandbox.
const CHROMIUM_SYSTEM_DEPS = [
  "nss", "nspr", "libxkbcommon", "atk", "at-spi2-atk", "at-spi2-core",
  "libXcomposite", "libXdamage", "libXrandr", "libXfixes", "libXcursor",
  "libXi", "libXtst", "libXScrnSaver", "libXext", "mesa-libgbm", "libdrm",
  "mesa-libGL", "mesa-libEGL", "cups-libs", "alsa-lib", "pango", "cairo",
  "gtk3", "dbus-libs",
];

const ENGINE_FILES = ["engine.mjs", "personas.mjs", "scent.mjs", "report.mjs", "run.mjs"];

function readEngineFile(name: string) {
  return readFileSync(path.join(process.cwd(), "lib", "engine", name), "utf8");
}

export async function getSandbox() {
  return Sandbox.getOrCreate({
    name: SANDBOX_NAME,
    runtime: "node24",
    timeout: SANDBOX_TIMEOUT_MS,
    resume: true,
    resources: { vcpus: 2 }, // real multi-process Chromium, not the single-process serverless-Function workaround
    onCreate: async (sbx) => {
      // mkDir isn't recursive — create the stable parent directories once,
      // up front, so per-run mkDir calls for runs/<uuid> always have a
      // parent to land in.
      await sbx.mkDir("/vercel/sandbox/runs");
      await sbx.mkDir("/vercel/sandbox/engine");
      await sbx.runCommand("sh", [
        "-c",
        `sudo dnf clean all 2>&1 && sudo dnf install -y --skip-broken ${CHROMIUM_SYSTEM_DEPS.join(" ")} 2>&1 && sudo ldconfig 2>&1`,
      ]);
      // A global npm install won't resolve for `import "playwright"` in an
      // ESM script — Node's ESM resolver doesn't honor NODE_PATH the way
      // CommonJS require() does. Install locally, relative to where
      // run.mjs actually executes, so normal node_modules resolution finds it.
      await sbx.runCommand({ cmd: "npm", args: ["install", "playwright"], cwd: "/vercel/sandbox/engine" });
      await sbx.runCommand({ cmd: "npx", args: ["playwright", "install", "chromium"], cwd: "/vercel/sandbox/engine" });
    },
  });
}

export async function writeEngineFiles(sandbox: Awaited<ReturnType<typeof getSandbox>>) {
  await sandbox.writeFiles(
    ENGINE_FILES.map((name) => ({
      path: `/vercel/sandbox/engine/${name}`,
      content: readEngineFile(name),
    }))
  );
}

export function runDirFor(runId: string) {
  return `/vercel/sandbox/runs/${runId}`;
}
