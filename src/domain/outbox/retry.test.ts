import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { afterFailure, MAX_ATTEMPTS, retryDelayMs } from "./retry";

const NOW = new Date("2026-09-14T12:00:00Z");

describe("retryDelayMs", () => {
  it("waits 1, 4, 16 and 64 minutes", () => {
    expect([1, 2, 3, 4].map((n) => retryDelayMs(n) / 60_000)).toEqual([
      1, 4, 16, 64,
    ]);
  });

  it("never shrinks as attempts grow", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20 }), (n) => {
        expect(retryDelayMs(n + 1)).toBeGreaterThanOrEqual(retryDelayMs(n));
      }),
    );
  });
});

describe("afterFailure", () => {
  it("queues the message again after the backoff", () => {
    expect(afterFailure(2, NOW)).toEqual({
      status: "queued",
      sendAfter: new Date("2026-09-14T12:04:00Z"),
    });
  });

  it("gives up after the last attempt", () => {
    expect(afterFailure(MAX_ATTEMPTS, NOW)).toEqual({ status: "failed" });
    expect(afterFailure(MAX_ATTEMPTS - 1, NOW).status).toBe("queued");
  });
});
