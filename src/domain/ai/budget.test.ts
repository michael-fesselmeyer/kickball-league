import { describe, expect, it } from "vitest";
import {
  aiAvailability,
  centsToMicrodollars,
  monthStart,
  nextMonthStart,
  parseBudgetDollars,
} from "./budget";

const NOW = new Date("2026-11-30T23:30:00Z");

describe("calendar months in UTC", () => {
  it("starts the month at midnight UTC on the first", () => {
    expect(monthStart(NOW)).toEqual(new Date("2026-11-01T00:00:00Z"));
    expect(nextMonthStart(NOW)).toEqual(new Date("2026-12-01T00:00:00Z"));
  });

  it("rolls over the year", () => {
    expect(nextMonthStart(new Date("2026-12-15T12:00:00Z"))).toEqual(
      new Date("2027-01-01T00:00:00Z"),
    );
  });
});

describe("aiAvailability", () => {
  const base = {
    configured: true,
    featureOn: true,
    budgetCents: 500,
    spentMicrodollars: 1_000_000,
    worstCaseMicrodollars: 112_000,
    now: NOW,
  };

  it("is hidden without a key or with the feature off", () => {
    expect(aiAvailability({ ...base, configured: false })).toEqual({
      kind: "hidden",
    });
    expect(aiAvailability({ ...base, featureOn: false })).toEqual({
      kind: "hidden",
    });
  });

  it("is ready while one more call fits in the budget", () => {
    expect(aiAvailability(base)).toEqual({
      kind: "ready",
      spentMicrodollars: 1_000_000,
      budgetMicrodollars: 5_000_000,
    });
    expect(
      aiAvailability({ ...base, spentMicrodollars: 5_000_000 - 112_000 }).kind,
    ).toBe("ready");
  });

  it("switches off when the next call could pass the budget, until next month", () => {
    expect(
      aiAvailability({ ...base, spentMicrodollars: 5_000_000 - 111_999 }),
    ).toEqual({
      kind: "over_budget",
      resumesOn: new Date("2026-12-01T00:00:00Z"),
      spentMicrodollars: 4_888_001,
    });
    expect(
      aiAvailability({ ...base, budgetCents: 0, spentMicrodollars: 0 }).kind,
    ).toBe("over_budget");
  });
});

describe("parseBudgetDollars", () => {
  it("reads whole dollars and cents", () => {
    expect(parseBudgetDollars("5")).toBe(500);
    expect(parseBudgetDollars(" 12.5 ")).toBe(1250);
    expect(parseBudgetDollars("0")).toBe(0);
    expect(parseBudgetDollars("1000.00")).toBe(100_000);
  });

  it("refuses anything else", () => {
    for (const bad of ["", "-1", "1,000", "$5", "5.001", "1000.01", "abc"])
      expect(parseBudgetDollars(bad)).toBeNull();
  });

  it("converts cents to microdollars", () => {
    expect(centsToMicrodollars(500)).toBe(5_000_000);
  });
});
