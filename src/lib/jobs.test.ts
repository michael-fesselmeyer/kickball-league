import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { refuseUnlessCron } from "./jobs";

const SECRET = "a-cron-secret-for-tests-only";
const call = (authorization?: string) =>
  new Request("https://league.example.test/api/jobs/outbox", {
    headers: authorization ? { authorization } : {},
  });

describe("refuseUnlessCron", () => {
  it("lets the scheduler in with the secret", () => {
    expect(refuseUnlessCron(call(`Bearer ${SECRET}`), SECRET)).toBeNull();
  });

  it("refuses a missing or wrong secret", () => {
    expect(refuseUnlessCron(call(), SECRET)?.status).toBe(401);
    expect(refuseUnlessCron(call("Bearer nope"), SECRET)?.status).toBe(401);
    expect(refuseUnlessCron(call(SECRET), SECRET)?.status).toBe(401);
  });

  it("refuses everyone when no secret is configured", () => {
    expect(refuseUnlessCron(call("Bearer "), undefined)?.status).toBe(503);
  });
});

describe("every scheduled job", () => {
  const jobsDir = join(__dirname, "..", "app", "api", "jobs");
  const jobs = readdirSync(jobsDir).filter((name) =>
    existsSync(join(jobsDir, name, "route.ts")),
  );
  const crons: { path: string }[] = JSON.parse(
    readFileSync(join(__dirname, "..", "..", "vercel.json"), "utf8"),
  ).crons;

  it("finds the jobs", () => {
    expect(jobs).toContain("digests");
  });

  it.each(jobs)(
    "%s checks the cron secret, skips while frozen and is scheduled",
    (name) => {
      const source = readFileSync(join(jobsDir, name, "route.ts"), "utf8");
      expect(source).toMatch(/refuseUnlessCron\(/);
      expect(source).toMatch(/refuseJobsWhileFrozen\(/);
      expect(crons.map((c) => c.path)).toContain(`/api/jobs/${name}`);
    },
  );
});
