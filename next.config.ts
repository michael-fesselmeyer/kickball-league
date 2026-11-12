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
