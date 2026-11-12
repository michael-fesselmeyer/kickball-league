import { defineConfig, devices } from "@playwright/test";

const SMOKE_PORT = 3100;
const FLOWS_PORT = 3110;

/**
 * End-to-end tests against a production build (`next start`) and a seeded
 * local Postgres (DATABASE_URL, whose name must contain "demo").
 *
 * - smoke: public pages at a phone size and a desktop size, demo mode off,
 *   the way the league's own site runs.
 * - flows: the core journeys (registration and Checkout, scheduling, scores,
 *   rain-outs) on a second server in demo mode, so each role signs in with
 *   one-tap "view as" (docs/adr/0004-demo-mode.md). Stripe calls go to
 *   stripe-mock on port 12111 (src/services/stripe-mock.ts).
 *
 * The flows change the data, so the database is reseeded before every run
 * and they are not retried.
 */
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/support/global-setup.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { trace: "retain-on-failure" },
  projects: [
    {
      name: "phone",
      testIgnore: "flows/**",
      use: { ...devices["Pixel 7"], baseURL: `http://localhost:${SMOKE_PORT}` },
    },
    {
      name: "desktop",
      testIgnore: "flows/**",
      use: {
        ...devices["Desktop Chrome"],
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
  ],
  webServer: [
    {
      command: `npm run build && npm run start -- --port ${SMOKE_PORT}`,
      url: `http://localhost:${SMOKE_PORT}`,
      reuseExistingServer: false,
      timeout: 240_000,
      stdout: "ignore",
      stderr: "pipe",
      env: { BETTER_AUTH_URL: `http://localhost:${SMOKE_PORT}` },
    },
    {
      // Starts after the first server, so the build is already there.
      command: `npm run start -- --port ${FLOWS_PORT}`,
      url: `http://localhost:${FLOWS_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
      env: {
        BETTER_AUTH_URL: `http://localhost:${FLOWS_PORT}`,
        DEMO_MODE: "true",
        // Placeholders in Stripe's test format, not real keys.
        STRIPE_SECRET_KEY: "sk_test_e2e",
        STRIPE_WEBHOOK_SECRET: "whsec_e2e",
        STRIPE_MOCK_URL: "http://localhost:12111",
      },
    },
  ],
});
