import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // playwright-core needs its non-JS asset files (browsers.json, etc.) at
  // runtime, but Next's automatic dependency tracer only follows JS
  // require/import statements and misses them — bundle the full packages
  // explicitly for the one route that needs them.
  outputFileTracingIncludes: {
    "/api/run": ["./node_modules/playwright-core/**/*", "./node_modules/@sparticuz/chromium/**/*"],
  },
};

export default nextConfig;
