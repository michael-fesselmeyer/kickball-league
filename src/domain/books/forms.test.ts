import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  isDay,
  LABEL_MAX,
  optionalCents,
  optionalDate,
  parseAmount,
  parseExpenseForm,
  parseRecurringForm,
  receiptChoice,
  typedCents,
} from "./forms";

describe("typedCents", () => {
  it("reads dollars the way owners type them", () => {
    expect(typedCents("45")).toBe(4500);
    expect(typedCents("45.5")).toBe(4550);
    expect(typedCents("$1,200")).toBe(120_000);
    expect(typedCents(" 12.30 ")).toBe(1230);
    expect(typedCents("$ 0.07")).toBe(7);
  });

  it("refuses anything that is not an amount", () => {
    for (const bad of ["", "abc", "1.234", "-5", "1e3", "12.", ".5", "1,2,3x"])
      expect(typedCents(bad)).toBeNull();
  });

  it("round-trips whole cents exactly, with no floating point drift", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9_999_999 }), (cents) => {
        const text = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
        expect(typedCents(text)).toBe(cents);
      }),
    );
  });
});

describe("isDay and optionalDate", () => {
  it("accepts real days and refuses impossible ones", () => {
    expect(isDay("2028-02-29")).toBe(true);
    expect(isDay("2027-02-29")).toBe(false);
    expect(isDay("2026-02-30")).toBe(false);
    expect(isDay("2026-13-01")).toBe(false);
    expect(isDay("2026-1-1")).toBe(false);
    expect(isDay("")).toBe(false);
  });

  it("treats empty as none and anything else as a date or an error", () => {
    expect(optionalDate("  ")).toEqual({ ok: true, value: null });
    expect(optionalDate(" 2027-03-01 ")).toEqual({
      ok: true,
      value: "2027-03-01",
    });
    expect(optionalDate("soon")).toEqual({ ok: false, error: "date" });
  });
});

describe("optionalCents and parseAmount", () => {
  it("allows empty and zero for optional, but needs more than zero for an amount", () => {
    expect(optionalCents("")).toEqual({ ok: true, value: null });
    expect(optionalCents("0")).toEqual({ ok: true, value: 0 });
    expect(optionalCents("x")).toEqual({ ok: false, error: "amount" });
    expect(parseAmount("0")).toEqual({ ok: false, error: "amount" });
    expect(parseAmount("$3")).toEqual({ ok: true, value: 300 });
  });
});

describe("receiptChoice", () => {
  it("defaults to later for anything unknown", () => {
    expect(receiptChoice("now")).toBe("now");
    expect(receiptChoice("none")).toBe("none");
    expect(receiptChoice("whenever")).toBe("later");
  });
});

describe("parseExpenseForm", () => {
  const good = {
    spentOn: "2027-03-01",
    amount: "$20",
    category: "refs",
    note: " cones ",
  };

  it("reads a good form and trims the note", () => {
    expect(parseExpenseForm(good)).toEqual({
      ok: true,
      value: {
        spentOn: "2027-03-01",
        amountCents: 2000,
        category: "refs",
        note: "cones",
      },
    });
  });

  it("names the first problem, in the form's order", () => {
    expect(
      parseExpenseForm({ ...good, spentOn: "2027-02-30", amount: "x" }),
    ).toEqual({ ok: false, error: "date" });
    expect(parseExpenseForm({ ...good, amount: "0" })).toEqual({
      ok: false,
      error: "amount",
    });
    expect(parseExpenseForm({ ...good, category: "yachts" })).toEqual({
      ok: false,
      error: "category",
    });
    expect(parseExpenseForm({ ...good, note: "x".repeat(201) })).toEqual({
      ok: false,
      error: "note",
    });
    expect(parseExpenseForm({ ...good, note: "x".repeat(200) }).ok).toBe(true);
  });
});

describe("parseRecurringForm", () => {
  const good = {
    label: "  Field\n  rental ",
    amount: "100",
    category: "fields_permits",
    cadence: "season",
    startsOn: "2027-03-01",
  };

  it("collapses the label's whitespace", () => {
    const r = parseRecurringForm(good);
    expect(r.ok && r.value.label).toBe("Field rental");
  });

  it("refuses each bad field by name", () => {
    expect(parseRecurringForm({ ...good, label: "   " })).toEqual({
      ok: false,
      error: "label",
    });
    expect(
      parseRecurringForm({ ...good, label: "x".repeat(LABEL_MAX + 1) }),
    ).toEqual({ ok: false, error: "label" });
    expect(parseRecurringForm({ ...good, amount: "-1" })).toEqual({
      ok: false,
      error: "amount",
    });
    expect(parseRecurringForm({ ...good, category: "nope" })).toEqual({
      ok: false,
      error: "category",
    });
    expect(parseRecurringForm({ ...good, cadence: "hourly" })).toEqual({
      ok: false,
      error: "cadence",
    });
    expect(parseRecurringForm({ ...good, startsOn: "2027-00-10" })).toEqual({
      ok: false,
      error: "date",
    });
  });
});
