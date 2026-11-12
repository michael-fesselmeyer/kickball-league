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
