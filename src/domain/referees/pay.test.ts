import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  dollarsField,
  MAX_PAY_CENTS,
  parseDollars,
  paySheet,
  payTotals,
} from "./pay";

const ref = (name: string, gamesWorked: number, paidCents: number) => ({
  userId: name.toLowerCase(),
  name,
  gamesWorked,
  paidCents,
});

describe("paySheet", () => {
  it("owes the season's fee for each game worked, less what was paid", () => {
    const [row] = paySheet([ref("Riley", 3, 2_500)], 2_500);
    expect(row).toMatchObject({ owedCents: 7_500, balanceCents: 5_000 });
  });

  it("owes nothing until the season has a fee", () => {
    const [row] = paySheet([ref("Riley", 3, 0)], null);
    expect(row).toMatchObject({ owedCents: 0, balanceCents: 0 });
  });

  it("lists the refs still owed money first, then by name", () => {
    const rows = paySheet(
      [ref("Avery", 2, 5_000), ref("Sam", 1, 0), ref("Blair", 2, 0)],
      2_500,
    );
    expect(rows.map((r) => r.name)).toEqual(["Blair", "Sam", "Avery"]);
  });

  it("balances: owed less paid is the balance, line by line and in total", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            gamesWorked: fc.nat({ max: 40 }),
            paidCents: fc.nat({ max: 200_000 }),
          }),
          { maxLength: 12 },
        ),
        fc.option(fc.nat({ max: MAX_PAY_CENTS }), { nil: null }),
        (lines, fee) => {
          const rows = paySheet(
            lines.map((l, i) => ref(`Ref ${i}`, l.gamesWorked, l.paidCents)),
            fee,
          );
          for (const r of rows)
            expect(r.balanceCents).toBe(r.owedCents - r.paidCents);
          const t = payTotals(rows);
          expect(t.balanceCents).toBe(t.owedCents - t.paidCents);
          expect(t.gamesWorked).toBe(
            lines.reduce((n, l) => n + l.gamesWorked, 0),
          );
        },
      ),
    );
  });
});

describe("parseDollars", () => {
  it("reads dollars and cents as typed", () => {
    expect(parseDollars("25")).toBe(2_500);
    expect(parseDollars("25.5")).toBe(2_550);
    expect(parseDollars("$ 25.05")).toBe(2_505);
    expect(parseDollars(" 0 ")).toBe(0);
  });

  it("refuses anything else, and more than $1,000", () => {
    for (const v of ["", "abc", "-5", "1.234", "25,00", "1001", null, 25])
      expect(parseDollars(v)).toBeNull();
    expect(parseDollars("1000")).toBe(MAX_PAY_CENTS);
  });

  it("round-trips with the form field", () => {
    fc.assert(
      fc.property(fc.nat({ max: MAX_PAY_CENTS }), (cents) => {
        expect(parseDollars(dollarsField(cents))).toBe(cents);
      }),
    );
  });
});
