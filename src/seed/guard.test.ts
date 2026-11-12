import { describe, expect, it } from "vitest";
import { canSeed } from "./guard";

const url = "postgresql://dev:dev@localhost:5432/dev";

describe("canSeed", () => {
  it("allows local development and previews", () => {
    expect(canSeed({ DATABASE_URL: url }).ok).toBe(true);
    expect(canSeed({ DATABASE_URL: url, NODE_ENV: "development" }).ok).toBe(
      true,
    );
    expect(canSeed({ DATABASE_URL: url, VERCEL_ENV: "preview" }).ok).toBe(true);
  });

  it.each([{ NODE_ENV: "production" }, { VERCEL_ENV: "production" }])(
    "refuses production (%o)",
    (env) => {
      const result = canSeed({ DATABASE_URL: url, ...env });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/production/);
    },
  );

  it("allows the demo deployment, whose database is all seed data", () => {
    expect(
      canSeed({
        DATABASE_URL: url,
        VERCEL_ENV: "production",
        DEMO_MODE: "true",
      }).ok,
    ).toBe(true);
  });

  it("needs a database to seed", () => {
    expect(canSeed({}).ok).toBe(false);
  });
});
