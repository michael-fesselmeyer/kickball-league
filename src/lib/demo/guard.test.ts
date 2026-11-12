import { describe, expect, it } from "vitest";
import { canResetDemo, demoStatus } from "./guard";

const demo = {
  DEMO_MODE: "true",
  DATABASE_URL: "postgresql://u:p@ep-example.neon.tech/kickball_demo",
};

describe("demoStatus", () => {
  it("is off by default", () => {
    expect(demoStatus({}).on).toBe(false);
    expect(demoStatus({ DATABASE_URL: demo.DATABASE_URL }).on).toBe(false);
  });

  it.each(["false", "1", "TRUE", "yes", " true", ""])(
    'is off unless DEMO_MODE is exactly "true" (%j)',
    (value) => {
      expect(demoStatus({ ...demo, DEMO_MODE: value }).on).toBe(false);
    },
  );

  it("is on for a demo database outside Vercel production", () => {
    expect(demoStatus(demo)).toEqual({ on: true });
    expect(demoStatus({ ...demo, VERCEL_ENV: "preview" })).toEqual({
      on: true,
    });
  });

  it.each([
    "postgresql://u:p@ep-example.neon.tech/neondb",
    "postgresql://u:p@ep-example.neon.tech/kickball?sslmode=require",
    "postgresql://u:p@demo-host.example.test/kickball",
    "postgresql://u:p@ep-example.neon.tech/",
    "not a url",
    undefined,
  ])("refuses a database whose name is not a demo's (%s)", (url) => {
    const status = demoStatus({ ...demo, DATABASE_URL: url });
    expect(status.on).toBe(false);
  });

  it("refuses the league's production deployment", () => {
    const status = demoStatus({
      ...demo,
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "kickball-league.vercel.app",
    });
    expect(status).toEqual({
      on: false,
      reason: expect.stringMatching(/production deployment/),
    });
    expect(demoStatus({ ...demo, VERCEL_ENV: "production" }).on).toBe(false);
  });

  it("allows the demo project's production deployment", () => {
    expect(
      demoStatus({
        ...demo,
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "kickball-league-demo.vercel.app",
      }).on,
    ).toBe(true);
  });

  it.each(["sk_live_abc123", "rk_live_abc123"])(
    "refuses live payments (%s)",
    (key) => {
      expect(demoStatus({ ...demo, STRIPE_SECRET_KEY: key })).toEqual({
        on: false,
        reason: "Stripe is in live mode.",
      });
    },
  );

  it("allows Stripe test mode", () => {
    expect(
      demoStatus({ ...demo, STRIPE_SECRET_KEY: "sk_test_abc123" }).on,
    ).toBe(true);
  });
});

describe("canResetDemo", () => {
  it("refuses with demo mode off, and says why", () => {
    const status = canResetDemo({ DATABASE_URL: demo.DATABASE_URL });
    expect(status).toEqual({
      on: false,
      reason: 'Refusing to reset: demo mode is off. DEMO_MODE is not "true".',
    });
  });

  it("refuses a development database even with DEMO_MODE set", () => {
    expect(
      canResetDemo({
        DEMO_MODE: "true",
        DATABASE_URL: "postgresql://ci:ci@localhost:5432/kickball",
      }).on,
    ).toBe(false);
  });

  it("allows the demo", () => {
    expect(canResetDemo(demo)).toEqual({ on: true });
  });
});
