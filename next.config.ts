import type { NextConfig } from "next";

import { loadEnv } from "./src/lib/env";

// Fail fast on missing or malformed environment variables whenever Next loads
// this config (build, dev, start). Only `npm run typecheck` opts out: route-type
// generation loads the config too but reads no values.
if (process.env.SKIP_ENV_VALIDATION !== "true") {
  loadEnv(process.env);
}

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  async headers() {
    return [
      {
        // The service worker is always checked for a new version, and may
        // load nothing from elsewhere (docs/architecture.md, section 14).
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'",
          },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
