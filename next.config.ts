import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Both routes read lib/engine/*.mjs as raw text (to write into the
  // sandbox) rather than importing them as JS modules, so Next's automatic
  // dependency tracer doesn't see the reference and would otherwise drop
  // them from the deployed function bundle.
  outputFileTracingIncludes: {
    "/api/run": ["./lib/engine/**/*"],
    "/api/status": ["./lib/engine/**/*"],
  },
};

export default nextConfig;
