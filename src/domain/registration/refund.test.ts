import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { refundAmount, refundableCents, statusAfterRefunds } from "./refund";

describe("refundAmount", () => {
  it("refunds everything left when the amount is blank", () => {
    expect(refundAmount("", 8500, 0)).toEqual({ ok: true, value: 8500 });
    expect(refundAmount(" ", 8500, 2000)).toEqual({ ok: true, value: 6500 });
  });

  it("reads dollars", () => {
    expect(refundAmount("$20", 8500, 0)).toEqual({ ok: true, value: 2000 });
    expect(refundAmount("12.5", 8500, 0)).toEqual({ ok: true, value: 1250 });
  });

  it("refuses nothing, junk, too much, or a payment already refunded", () => {
    expect(refundAmount("0", 8500, 0)).toEqual({
      ok: false,
      error: "bad_amount",
    });
    expect(refundAmount("ten", 8500, 0)).toEqual({
      ok: false,
      error: "bad_amount",
    });
    expect(refundAmount("70", 8500, 2000)).toEqual({
      ok: false,
      error: "too_much",
    });
    expect(refundAmount("", 8500, 8500)).toEqual({
      ok: false,
      error: "nothing_left",
    });
  });

  it("never refunds more than is left, whatever is typed", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500_000 }),
        fc.integer({ min: 0, max: 500_000 }),
        fc.oneof(
          fc.constant(""),
          fc.string(),
          fc
            .integer({ min: 0, max: 9_999_999 })
            .map((c) => (c / 100).toFixed(2)),
        ),
        (paid, refunded, typed) => {
          const result = refundAmount(typed, paid, refunded);
          if (result.ok) {
            expect(result.value).toBeGreaterThan(0);
            expect(result.value).toBeLessThanOrEqual(
              refundableCents(paid, refunded),
            );
          }
        },
      ),
    );
  });
});

describe("statusAfterRefunds", () => {
  it("is paid, partly refunded or refunded", () => {
    expect(statusAfterRefunds(8500, 0)).toBe("paid");
    expect(statusAfterRefunds(8500, 2000)).toBe("partially_refunded");
    expect(statusAfterRefunds(8500, 8500)).toBe("refunded");
  });

  it("is refunded exactly when nothing is left to refund", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500_000 }),
        fc.integer({ min: 0, max: 500_000 }),
        (paid, refunded) => {
          const status = statusAfterRefunds(paid, Math.min(refunded, paid));
          expect(status === "refunded").toBe(
            refundableCents(paid, Math.min(refunded, paid)) === 0,
          );
        },
      ),
    );
  });
});
