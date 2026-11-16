import type { NextConfig } from "next";

import { loadEnv } from "./src/lib/env";
import {
  optimizedPhotoLifetime,
  PHOTO_DEVICE_SIZES,
  PHOTO_IMAGE_SIZES,
} from "./src/lib/media/optimizer-cache";
import { securityHeaderRules } from "./src/lib/security-headers";

// Fail fast on missing or malformed environment variables whenever Next loads
// this config (build, dev, start). Only `npm run typecheck` opts out: route-type
// generation loads the config too but reads no values.
if (process.env.SKIP_ENV_VALIDATION !== "true") {
  loadEnv(process.env);
}

const nextConfig: NextConfig = {
  /* config options here */
  // The end-to-end flows server runs its own build made in demo mode
  // (playwright.config.ts), kept beside the normal one.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  images: {
    // Only our stored photos (Instagram copies, merch items and members'
    // approved photos) are optimized, never another path.
    localPatterns: [
      { pathname: "/media/instagram/**", search: "" },
      { pathname: "/media/merch/**", search: "" },
      { pathname: "/media/photos/**", search: "" },
    ],
    // Each optimized copy counts against the free plan's 5,000 image
    // transformations a month when it is made, so on Vercel, with its purge
    // wired in, copies are kept for 31 days and every takedown purges a
    // photo's copies at once (ADR 0069, src/lib/media/host-purger.ts).
    // Elsewhere nothing can purge them, so they last the photo's own five
    // minutes.
    minimumCacheTTL: optimizedPhotoLifetime(process.env),
    // Every width, format and quality is its own transformation, so only
    // those the pages ask for are allowed: the photos' sizes reach no wider
    // than a desktop cover, and stored photos are at most 1,440 px wide.
    deviceSizes: [...PHOTO_DEVICE_SIZES],
    imageSizes: [...PHOTO_IMAGE_SIZES],
    formats: ["image/webp"],
    qualities: [75],
  },
  partialPrefetching: true,
  experimental: {
    serverActions: {
      // A receipt photo or permit PDF (ADR 0034), a merch photo straight
      // from a phone, up to 3 MB (ADR 0037), or a member's photo (ADR 0039).
      // Books and member photos are shrunk in the browser first; this covers
      // a 1 MB PDF and a photo sent without JavaScript. Under Vercel's 4.5 MB
      // request limit.
      bodySizeLimit: "4mb",
    },
  },
  async headers() {
    return [
      // Every page and route (ADR 0044); only the schedule widget under
      // /embed may be framed. Rules below override a header for their own
      // paths.
      ...securityHeaderRules({
        dev: process.env.NODE_ENV === "development",
      }),
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
    // Only the demo deployment shows the demo banner, and it is built with
    // DEMO_MODE=true (docs/demo.md), so any other build leaves the
    // banner's client code out of every page.
    resolveAlias:
      process.env.DEMO_MODE === "true"
        ? {}
        : { "@/components/demo-tools": "./src/components/demo-tools-off.ts" },
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
