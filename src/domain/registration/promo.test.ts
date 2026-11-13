import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formatCents } from "./pricing";
import {
  CARD_MINIMUM_CENTS,
  checkPromo,
  describePromo,
  normalizeCode,
  parsePromoForm,
  type PromoRule,
  promoDiscount,
  spreadDiscount,
  type StoredPromo,
} from "./promo";

const NOW = new Date("2027-02-15T17:00:00Z");
const promo = (over: Partial<StoredPromo> = {}): StoredPromo => ({
  code: "SPRING10",
  kind: "percent",
  value: 10,
  maxRedemptions: null,
  validUntil: null,
  redemptions: 0,
  ...over,
});

const rule: fc.Arbitrary<PromoRule> = fc.oneof(
  fc.record({
    kind: fc.constant("percent" as const),
    value: fc.integer({ min: 1, max: 100 }),
  }),
  fc.record({
    kind: fc.constant("amount" as const),
    value: fc.integer({ min: 1, max: 200_000 }),
  }),
);

describe("normalizeCode", () => {
  it("matches codes without regard to case or spaces", () => {
    expect(normalizeCode("  spring-10 ")).toBe("SPRING-10");
  });

  it("refuses what cannot be a code", () => {
    for (const bad of ["", "ab", "-LEADING", "has space", "x".repeat(25), 7])
      expect(normalizeCode(bad)).toBeNull();
  });
});

describe("checkPromo", () => {
  it("accepts a live code", () => {
    expect(checkPromo(promo(), NOW)).toEqual({ ok: true, value: promo() });
  });

  it("refuses an unknown, expired or used-up code", () => {
    expect(checkPromo(null, NOW)).toEqual({
      ok: false,
      error: "unknown_code",
    });
    expect(
      checkPromo(promo({ validUntil: new Date("2027-02-15T16:59:59Z") }), NOW),
    ).toEqual({ ok: false, error: "expired" });
    expect(
      checkPromo(promo({ maxRedemptions: 3, redemptions: 3 }), NOW),
    ).toEqual({ ok: false, error: "used_up" });
  });

  it("works up to the last moment and the last use", () => {
    expect(checkPromo(promo({ validUntil: NOW }), NOW).ok).toBe(true);
    expect(
      checkPromo(promo({ maxRedemptions: 3, redemptions: 2 }), NOW).ok,
    ).toBe(true);
  });
});

describe("promoDiscount", () => {
  it("takes a percentage or an amount off", () => {
    expect(promoDiscount(8500, { kind: "percent", value: 10 })).toBe(850);
    expect(promoDiscount(8500, { kind: "amount", value: 1500 })).toBe(1500);
    expect(promoDiscount(8500, { kind: "percent", value: 100 })).toBe(8500);
  });

  it("rounds a percentage down to the cent", () => {
    expect(promoDiscount(999, { kind: "percent", value: 15 })).toBe(149);
  });

  it("never leaves a charge under the card minimum", () => {
    expect(promoDiscount(8500, { kind: "amount", value: 8480 })).toBe(8450);
    expect(promoDiscount(8500, { kind: "amount", value: 9000 })).toBe(8500);
  });

  it("stays between nothing and the subtotal, leaving zero or a payable total", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 500_000 }), rule, (subtotal, r) => {
        const discount = promoDiscount(subtotal, r);
        const total = subtotal - discount;
        expect(Number.isInteger(discount)).toBe(true);
        expect(discount).toBeGreaterThanOrEqual(0);
        expect(discount).toBeLessThanOrEqual(subtotal);
        expect(
          total === 0 || total >= Math.min(subtotal, CARD_MINIMUM_CENTS),
        ).toBe(true);
      }),
    );
  });

  it("never takes off more than the code promises", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 500_000 }), rule, (subtotal, r) => {
        const promised =
          r.kind === "percent" ? (subtotal * r.value) / 100 : r.value;
        expect(promoDiscount(subtotal, r)).toBeLessThanOrEqual(promised);
      }),
    );
  });
});

describe("spreadDiscount", () => {
  it("spreads a discount in proportion and hands leftover cents to the largest", () => {
    expect(spreadDiscount([8000], 800)).toEqual([7200]);
    expect(spreadDiscount([6000, 3000], 1000)).toEqual([5333, 2667]);
    expect(spreadDiscount([100, 100, 100], 100)).toEqual([66, 67, 67]);
  });

  it("adds up to the subtotal less the discount, with no item below zero", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 200_000 }), {
          minLength: 1,
          maxLength: 6,
        }),
        fc.integer({ min: 0, max: 1_500_000 }),
        (amounts, wanted) => {
          const subtotal = amounts.reduce((s, a) => s + a, 0);
          const discount = Math.min(wanted, subtotal);
          const spread = spreadDiscount(amounts, discount);
          expect(spread).toHaveLength(amounts.length);
          expect(spread.reduce((s, a) => s + a, 0)).toBe(subtotal - discount);
          spread.forEach((a, i) => {
            expect(a).toBeGreaterThanOrEqual(0);
            expect(a).toBeLessThanOrEqual(amounts[i] ?? 0);
          });
        },
      ),
    );
  });
});

describe("describePromo", () => {
  it("says what it takes off", () => {
    expect(describePromo({ kind: "percent", value: 10 }, formatCents)).toBe(
      "10% off",
    );
    expect(describePromo({ kind: "amount", value: 1500 }, formatCents)).toBe(
      "$15 off",
    );
  });
});

describe("parsePromoForm", () => {
  const form = {
    code: "spring10",
    kind: "percent",
    value: "10",
    maxRedemptions: "",
    validUntil: "",
  };

  it("reads a percentage code with no limit and no last day", () => {
    expect(parsePromoForm(form, "America/New_York")).toEqual({
      ok: true,
      value: {
        code: "SPRING10",
        kind: "percent",
        value: 10,
        maxRedemptions: null,
        validUntil: null,
      },
    });
  });

  it("reads an amount, a limit and a last day that ends at local midnight", () => {
    const parsed = parsePromoForm(
      {
        code: "RETURNING",
        kind: "amount",
        value: "$7.50",
        maxRedemptions: "25",
        validUntil: "2027-03-01",
      },
      "America/New_York",
    );
    expect(parsed).toEqual({
      ok: true,
      value: {
        code: "RETURNING",
        kind: "amount",
        value: 750,
        maxRedemptions: 25,
        validUntil: new Date("2027-03-02T04:59:59.999Z"),
      },
    });
  });

  it("names each field that is wrong", () => {
    const parsed = parsePromoForm(
      {
        code: "x",
        kind: "percent",
        value: "120",
        maxRedemptions: "0",
        validUntil: "2027-02-30",
      },
      "America/New_York",
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok)
      expect(Object.keys(parsed.error).sort()).toEqual([
        "code",
        "maxRedemptions",
        "validUntil",
        "value",
      ]);
    expect(
      parsePromoForm({ ...form, kind: "amount", value: "0" }, "UTC").ok,
    ).toBe(false);
    expect(parsePromoForm({ ...form, kind: "free" }, "UTC")).toEqual({
      ok: false,
      error: { kind: "Choose a percentage or an amount." },
    });
  });
});
