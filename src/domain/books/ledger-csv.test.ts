import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { toCsv } from "../export/csv";
import { LEDGER_COLUMNS, ledgerLines, localDate } from "./ledger-csv";

const NY = "America/New_York";

const payment = (
  over: Partial<Parameters<typeof ledgerLines>[0]["payments"][number]> = {},
) => ({
  method: "stripe",
  amountCents: 8500,
  refundedCents: 0,
  paidAt: new Date("2027-03-02T15:00:00Z"),
  createdAt: new Date("2027-03-01T15:00:00Z"),
  kinds: ["player_fee"] as string[] | null,
  ...over,
});

const none = { payments: [], expenses: [], permitCosts: [] };

describe("localDate", () => {
  it("dates an evening instant by the league's calendar, not UTC", () => {
    // 9 pm in New York on March 1 is already March 2 in UTC.
    expect(localDate(new Date("2027-03-02T02:00:00Z"), NY)).toBe("2027-03-01");
    expect(localDate(new Date("2027-03-02T02:00:00Z"), "UTC")).toBe(
      "2027-03-02",
    );
  });
});

describe("ledgerLines", () => {
  it("writes a payment as income, labelled by method and what it paid for", () => {
    const [line] = ledgerLines(
      { ...none, payments: [payment({ kinds: ["team_fee", "merch"] })] },
      NY,
    );
    expect(line).toEqual({
      date: "2027-03-02",
      type: "Income",
      category: "Paid in the app",
      description: "Team fee, Merch",
      amountCents: 8500,
      receipt: null,
    });
  });

  it("falls back to the payment date when unpaid, and to plain labels when unknown", () => {
    const [line] = ledgerLines(
      {
        ...none,
        payments: [payment({ paidAt: null, method: "barter", kinds: [] })],
      },
      NY,
    );
    expect(line?.date).toBe("2027-03-01");
    expect(line?.category).toBe("barter");
    expect(line?.description).toBe("Payment");
    const [nullKinds] = ledgerLines(
      { ...none, payments: [payment({ kinds: null })] },
      NY,
    );
    expect(nullKinds?.description).toBe("Payment");
    const [unknownKind] = ledgerLines(
      { ...none, payments: [payment({ kinds: ["mystery"] })] },
      NY,
    );
    expect(unknownKind?.description).toBe("mystery");
  });

  it("adds a negative refund line only when something was refunded", () => {
    const lines = ledgerLines(
      { ...none, payments: [payment({ refundedCents: 2000, method: "cash" })] },
      NY,
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({
      type: "Refund",
      category: "Cash",
      description: "Refunded: Player fee",
      amountCents: -2000,
    });
  });

  it("writes expenses as negatives with whether a receipt is on file", () => {
    const lines = ledgerLines(
      {
        ...none,
        expenses: [
          {
            spentOn: "2027-03-05",
            amountCents: 1200,
            category: "shirts",
            note: "Reprint",
            receiptFileId: "f1",
          },
          {
            spentOn: "2027-03-04",
            amountCents: 300,
            category: "other",
            note: null,
            receiptFileId: null,
          },
        ],
      },
      NY,
    );
    expect(
      lines.map((l) => [l.date, l.amountCents, l.receipt, l.description]),
    ).toEqual([
      ["2027-03-04", -300, false, ""],
      ["2027-03-05", -1200, true, "Reprint"],
    ]);
  });

  it("counts a permit's cost on its game's local date and skips free or unpriced ones", () => {
    const lines = ledgerLines(
      {
        ...none,
        permitCosts: [
          {
            startsAt: new Date("2027-04-01T01:00:00Z"),
            costCents: 4000,
            permitNumber: "P-7",
            fieldName: "Field 1",
          },
          {
            startsAt: new Date("2027-04-02T18:00:00Z"),
            costCents: 2500,
            permitNumber: null,
            fieldName: "Field 2",
          },
          {
            startsAt: new Date("2027-04-03T18:00:00Z"),
            costCents: 0,
            permitNumber: "P-8",
            fieldName: "Field 3",
          },
          {
            startsAt: new Date("2027-04-04T18:00:00Z"),
            costCents: null,
            permitNumber: null,
            fieldName: "Field 4",
          },
        ],
      },
      NY,
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      date: "2027-03-31",
      category: "Fields and permits",
      description: "Permit P-7, Field 1 (this date's share)",
      amountCents: -4000,
    });
    expect(lines[1]?.description).toBe("Permit, Field 2 (this date's share)");
  });

  it("sorts everything by date", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.date({
            min: new Date("2026-01-01"),
            max: new Date("2028-01-01"),
            noInvalidDate: true,
          }),
          { maxLength: 12 },
        ),
        (dates) => {
          const lines = ledgerLines(
            { ...none, payments: dates.map((d) => payment({ paidAt: d })) },
            NY,
          );
          const days = lines.map((l) => l.date);
          expect(days).toEqual([...days].sort());
        },
      ),
    );
  });

  it("nets to what was paid less refunds and spend, for any mix of rows", () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat(100_000), { maxLength: 8 }),
        fc.array(fc.nat(100_000), { maxLength: 8 }),
        (paid, spent) => {
          const lines = ledgerLines(
            {
              ...none,
              payments: paid.map((a) =>
                payment({ amountCents: a, refundedCents: Math.floor(a / 4) }),
              ),
              expenses: spent.map((a) => ({
                spentOn: "2027-03-01",
                amountCents: a,
                category: "other" as const,
                note: null,
                receiptFileId: null,
              })),
            },
            NY,
          );
          const net = lines.reduce((s, l) => s + l.amountCents, 0);
          const expected =
            paid.reduce((s, a) => s + a - Math.floor(a / 4), 0) -
            spent.reduce((s, a) => s + a, 0);
          expect(net).toBe(expected);
        },
      ),
    );
  });
});

describe("LEDGER_COLUMNS", () => {
  it("writes amounts as numbers in dollars, so negatives are not defused as text", () => {
    const lines = ledgerLines(
      {
        ...none,
        expenses: [
          {
            spentOn: "2027-03-05",
            amountCents: 1250,
            category: "refs",
            note: '=HYPERLINK("x")',
            receiptFileId: null,
          },
        ],
      },
      NY,
    );
    const csv = toCsv(LEDGER_COLUMNS, lines);
    expect(csv).toContain(",-12.5,no\r\n");
    // A note that starts like a formula is defused.
    expect(csv).toContain('"\'=HYPERLINK(""x"")"');
  });

  it("leaves the receipt cell empty for income", () => {
    const csv = toCsv(
      LEDGER_COLUMNS,
      ledgerLines({ ...none, payments: [payment()] }, NY),
    );
    expect(csv.trimEnd().endsWith("85,")).toBe(true);
  });
});
