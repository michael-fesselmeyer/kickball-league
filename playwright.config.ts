import { defineConfig, devices } from "@playwright/test";

// Another worker's run on the same machine can pick other ports.
const SMOKE_PORT = Number(process.env.E2E_SMOKE_PORT ?? 3100);
const FLOWS_PORT = Number(process.env.E2E_FLOWS_PORT ?? 3110);
// CI builds once and hands the build to every shard (E2E_PREBUILT); a local
// run builds first. Both builds read the seeded league, so the public
// seasons and teams are prerendered as in production. The web servers start
// before the global setup, so a local run seeds here too.
const PREBUILT = process.env.E2E_PREBUILT === "true";
const BUILD_FIRST = PREBUILT
  ? ""
  : "npm run --silent seed && npm run build && ";
// The operator's site-wide switches (read-only, paused, features) change the
// site for every test at once, so they run on their own, after the rest:
// `npm run test:e2e:site-wide` sets this.
const SITE_WIDE = process.env.E2E_SITE_WIDE === "true";

/**
 * End-to-end tests against a production build (`next start`) and a seeded
 * local Postgres (DATABASE_URL, whose name must contain "demo").
 *
 * - smoke: public pages at a phone size and a desktop size, demo mode off,
 *   the way the league's own site runs.
 * - flows: the core journeys (registration and Checkout, scheduling, scores,
 *   rain-outs) on a second server in demo mode, so each role signs in with
 *   one-tap "view as" (docs/adr/0004-demo-mode.md). Stripe calls go to
 *   stripe-mock on port 12111 (src/services/stripe-mock.ts), and Instagram
 *   is its recorded fixture (src/services/instagram-fixture.ts).
 *
 * - site-wide: the operator console's read-only, paused and feature
 *   switches, on the flows server, in a run of their own.
 *
 * The flows change the data, so the database is reseeded before every run
 * and they are not retried.
 */
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/support/global-setup.ts",
  fullyParallel: true,
  // The site-wide files each flip the whole site, so they take turns.
  ...(SITE_WIDE ? { workers: 1 } : {}),
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { trace: "retain-on-failure" },
  projects: SITE_WIDE
    ? [
        {
          name: "site-wide",
          testMatch: "site-wide/**/*.spec.ts",
          retries: 0,
          use: {
            ...devices["Desktop Chrome"],
            baseURL: `http://localhost:${FLOWS_PORT}`,
          },
        },
      ]
    : // `--shard` cuts this list, in this order, into contiguous pieces, so
      // the flows sit between the two smoke projects: each CI shard gets
      // half the smoke tests and half the flows.
      [
        {
          name: "phone",
          testIgnore: ["flows/**", "site-wide/**"],
          use: {
            ...devices["Pixel 7"],
            baseURL: `http://localhost:${SMOKE_PORT}`,
          },
        },
        {
          name: "flows",
          testMatch: "flows/**/*.spec.ts",
          retries: 0,
          use: {
            ...devices["Desktop Chrome"],
            baseURL: `http://localhost:${FLOWS_PORT}`,
          },
        },
        {
          name: "desktop",
          testIgnore: ["flows/**", "site-wide/**"],
          use: {
            ...devices["Desktop Chrome"],
            baseURL: `http://localhost:${SMOKE_PORT}`,
          },
        },
      ],
  webServer: [
    ...(SITE_WIDE
      ? []
      : [
          {
            command: `${BUILD_FIRST}npm run start -- --port ${SMOKE_PORT}`,
            url: `http://localhost:${SMOKE_PORT}`,
            reuseExistingServer: false,
            timeout: PREBUILT ? 60_000 : 240_000,
            stdout: "ignore" as const,
            stderr: "pipe" as const,
            env: { BETTER_AUTH_URL: `http://localhost:${SMOKE_PORT}` },
          },
        ]),
    {
      // In the full run it starts after the first server, so the build is
      // already there; the site-wide run starts only this one.
      command: `${SITE_WIDE ? BUILD_FIRST : ""}npm run start -- --port ${FLOWS_PORT}`,
      url: `http://localhost:${FLOWS_PORT}`,
      reuseExistingServer: false,
      timeout: SITE_WIDE && !PREBUILT ? 240_000 : 60_000,
      stdout: "ignore",
      stderr: "pipe",
      env: {
        BETTER_AUTH_URL: `http://localhost:${FLOWS_PORT}`,
        DEMO_MODE: "true",
        // The demo admin persona (src/seed/demo-personas.ts) runs the
        // operator console, so its screen can be checked.
        OPERATOR_USER_IDS: "d3e30000-0000-4000-8000-000000000004",
        // Placeholders in Stripe's test format, not real keys.
        STRIPE_SECRET_KEY: "sk_test_e2e",
        STRIPE_WEBHOOK_SECRET: "whsec_e2e",
        STRIPE_MOCK_URL: "http://localhost:12111",
        // Lets the flows call the scheduled jobs; a placeholder, not a key.
        CRON_SECRET: "e2e-cron-placeholder",
        // Instagram played back from its recorded fixture, never the network.
        INSTAGRAM_FIXTURE: "true",
      },
    },
  ],
});
