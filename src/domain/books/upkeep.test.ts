import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { csvCell } from "../export/csv";
import { expectedCosts, occurrenceKey, type RecurringCost } from "./expected";
import { isDay, parseRecurringForm, receiptChoice, typedCents } from "./forms";
import {
  BUILT_IN_RULES,
  cleanDescription,
  decodeStatement,
  guessCategory,
  looksLikeTransfer,
  maskNumbers,
  parseCsv,
  readStatement,
  rulePattern,
  STATEMENT_MAX_ROWS,
  statementAmount,
  statementDate,
} from "./statement";
import { nudgeKey, nudgeMonth, owedByPerson } from "./upkeep";

// Synthetic statements, shaped like the real exports.
const VENMO = [
  "Account Statement - (@example-league) ,,,,,,,,,,,",
  "Account Activity,,,,,,,,,,,",
  ",ID,Datetime,Type,Status,Note,From,To,Amount (total),Amount (tip),Amount (fee),Funding Source,Destination",
  ",,,,,,,,,,,$0.00,",
  ',4000000000000000001,2026-10-03T19:22:11,Payment,Complete,Ref pay week 3,Example League,Riley Ref,"- $120.00",,,Venmo balance,',
  ',4000000000000000002,2026-10-04T10:00:00,Payment,Complete,Fall fee,Pat Player,Example League,"+ $45.00",,,,Venmo balance',
  ',4000000000000000003,2026-10-05T12:00:00,Payment,Pending,Cones,Example League,Gear Shop,"- $30.00",,,Venmo balance,',
  ',4000000000000000004,2026-10-06T12:00:00,Payment,Complete,Bar deposit,Example League,The Example Tavern,"- $200.00",,,Venmo balance,',
  ',4000000000000000005,2026-10-07T09:00:00,Standard Transfer,Complete,,,,"- $95.00",,,,Example Bank',
  ',4000000000000000006,2026-10-08T09:00:00,Payment,Complete,Refund for cones,Gear Shop,Example League,"+ $30.00",,,,Venmo balance',
  ",,,,,,,,,,,$0.00,",
].join("\n");

const BANK = [
  "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
  "DEBIT,10/01/2026,NYC PARKS PERMIT 1234567890 ACCT 4417123412341234,-450.00,ACH_DEBIT,1000.00,",
  "DEBIT,10/02/2026,EXAMPLE SCREEN PRINT CO,-240.00,DEBIT_CARD,760.00,",
  "CREDIT,10/03/2026,ONLINE TRANSFER FROM SAVINGS,500.00,ACCT_XFER,1260.00,",
  "DEBIT,10/02/2026,EXAMPLE SCREEN PRINT CO,-240.00,DEBIT_CARD,1020.00,",
].join("\r\n");

const DEBIT_CREDIT = [
  "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit",
  "2026-10-07,2026-10-08,1234,EXAMPLE SPORTING GOODS,Shopping,58.20,",
  "2026-10-09,2026-10-10,1234,PAYMENT THANK YOU,Payment,,300.00",
  "2026-10-11,2026-10-11,1234,CARD VERIFICATION,Other,0.00,",
].join("\n");

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, commas and CRLF", () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\r\n')).toEqual([
      ["a", "b, c", 'say "hi"'],
      ["1", "2", "3"],
    ]);
  });

  it("reads back any cells written by the export's CSV writer", () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(fc.string(), { minLength: 1, maxLength: 5 }), {
          minLength: 1,
          maxLength: 5,
        }),
        (rows) => {
          const kept = rows.filter((r) => r.some((c) => c.trim() !== ""));
          const text = kept
            .map((r) => r.map((c) => csvCell(c)).join(","))
            .join("\n");
          const read = parseCsv(text).map((r) =>
            r.map((c) => (c.startsWith("'") ? c.slice(1) : c)),
          );
          expect(read.length).toBe(kept.length);
        },
      ),
    );
  });
});

describe("masking account numbers", () => {
  it("masks runs of five or more digits, keeping the last two", () => {
    expect(maskNumbers("ACCT 4417123412341234 ref 12-345-678")).toBe(
      "ACCT ••••34 ref ••••78",
    );
    expect(maskNumbers("Store 1234 on 5th")).toBe("Store 1234 on 5th");
  });

  it("never leaves five digits in a row", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(cleanDescription(text)).not.toMatch(/\d{5}/);
        expect(maskNumbers(text)).not.toMatch(/\d(?:[\s-]?\d){4}/);
      }),
    );
  });
});

describe("statementDate and statementAmount", () => {
  it.each([
    ["10/03/2026", "2026-10-03"],
    ["1/2/26", "2026-01-02"],
    ["2026-10-03T19:22:11", "2026-10-03"],
    ["2026/10/03", "2026-10-03"],
    ["2026-02-30", null],
    ["2/29/27", null],
    ["yesterday", null],
  ])("%s → %s", (text, day) => {
    expect(statementDate(text)).toBe(day);
  });

  it.each([
    ["- $120.00", -12000],
    ["$-120.00", -12000],
    ["120.00-", -12000],
    ["−120.00", -12000],
    ["(25.00)", -2500],
    ["25.00 DR", -2500],
    ["25.00CR", 2500],
    ["-25", -2500],
    ["+ $1,200.50", 120050],
    ["0.10", 10],
    ["0.1", 10],
    ["$", null],
    ["12.345", null],
    ["--5", null],
    ["$150,000.00", null],
    ["1e3", null],
  ])("%s → %s", (text, cents) => {
    expect(statementAmount(text)).toBe(cents);
  });

  it("reads any typed amount to the exact cent, with no float drift", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 9_999_999 }), (cents) => {
        const text = `-$${Math.floor(cents / 100).toLocaleString("en-US")}.${String(cents % 100).padStart(2, "0")}`;
        expect(statementAmount(text)).toBe(-cents);
      }),
    );
  });
});

describe("decodeStatement", () => {
  const line = "Date,Description,Amount\n2026-10-03,Café Example,-4.50\n";

  it("reads UTF-8 with or without a byte-order mark", () => {
    const utf8 = new TextEncoder().encode(line);
    expect(decodeStatement(utf8)).toBe(line);
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]);
    const read = readStatement(decodeStatement(bom));
    expect(read.ok && read.value.rows[0]?.description).toBe("Café Example");
  });

  it("reads UTF-16 with a byte-order mark", () => {
    const units = [...line].flatMap((c) => {
      const code = c.charCodeAt(0);
      return [code & 0xff, code >> 8];
    });
    expect(decodeStatement(new Uint8Array([0xff, 0xfe, ...units]))).toBe(line);
  });

  it("falls back to Windows-1252 when the bytes aren't UTF-8", () => {
    const bytes = new Uint8Array(
      [...line].map((c) => (c === "é" ? 0xe9 : c.charCodeAt(0))),
    );
    expect(decodeStatement(bytes)).toBe(line);
  });
});

describe("readStatement", () => {
  it("reads a Venmo statement: completed money out only, keyed by its ID", () => {
    const read = readStatement(VENMO);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.source).toBe("venmo");
    expect(read.value.rows).toEqual([
      {
        spentOn: "2026-10-03",
        amountCents: 12000,
        description: "Riley Ref · Ref pay week 3",
        key: "venmo:4000000000000000001",
      },
      {
        spentOn: "2026-10-06",
        amountCents: 20000,
        description: "The Example Tavern · Bar deposit",
        key: "venmo:4000000000000000004",
      },
    ]);
    // A player's fee and a shop's refund are money in; the bank transfer
    // moves money and the closing balance line is skipped.
    expect(read.value.moneyIn).toBe(2);
    expect(read.value.transfers).toBe(1);
    expect(read.value.unreadable).toBe(0);
  });

  it("skips $0 lines without calling them unreadable", () => {
    const read = readStatement(DEBIT_CREDIT);
    if (!read.ok) throw new Error(read.error);
    expect(read.value.rows).toHaveLength(1);
    expect(read.value.unreadable).toBe(0);
  });

  it("counts a dated row whose amount can't be read", () => {
    const read = readStatement(
      "Date,Description,Amount\n2026-10-03,Something,abc\n2026-10-04,Fine,-1.00",
    );
    if (!read.ok) throw new Error(read.error);
    expect(read.value.rows).toHaveLength(1);
    expect(read.value.unreadable).toBe(1);
  });

  it("flags transfers between accounts by their description", () => {
    expect(looksLikeTransfer("ONLINE TRANSFER TO SAVINGS")).toBe(true);
    expect(looksLikeTransfer("Venmo cash out")).toBe(true);
    expect(looksLikeTransfer("EXAMPLE SPORTING GOODS")).toBe(false);
  });

  it("reads a bank export, masking numbers and telling identical rows apart", () => {
    const read = readStatement(BANK);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.source).toBe("bank");
    const [permit, shirts, again] = read.value.rows;
    expect(permit?.description).toBe("NYC PARKS PERMIT ••••90 ACCT ••••34");
    const all = JSON.stringify(read.value);
    expect(all).not.toContain("4417123412341234");
    expect(all).not.toContain("1234567890");
    expect(shirts?.amountCents).toBe(24000);
    expect(shirts?.key).not.toBe(again?.key);
    expect(read.value.moneyIn).toBe(1);
  });

  it("reads debit and credit columns and never reads the card number column", () => {
    const read = readStatement(DEBIT_CREDIT);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.rows).toEqual([
      expect.objectContaining({
        spentOn: "2026-10-07",
        amountCents: 5820,
        description: "EXAMPLE SPORTING GOODS",
      }),
    ]);
    expect(read.value.moneyIn).toBe(1);
  });

  it("gives the same keys for the same rows in an overlapping statement", () => {
    const first = readStatement(BANK);
    const second = readStatement(BANK.split("\r\n").slice(0, 3).join("\n"));
    if (!first.ok || !second.ok) throw new Error("unread");
    expect(second.value.rows.map((r) => r.key)).toEqual(
      first.value.rows.slice(0, 2).map((r) => r.key),
    );
  });

  it("refuses a file it can't recognize, an empty one and a huge one", () => {
    expect(readStatement("")).toEqual({ ok: false, error: "empty" });
    expect(readStatement("name,email\nPat,pat@example.test")).toEqual({
      ok: false,
      error: "unrecognized",
    });
    expect(readStatement("x".repeat(600_000))).toEqual({
      ok: false,
      error: "too_big",
    });
  });

  it("stops at the row limit and counts the rest", () => {
    const lines = ["Date,Description,Amount"];
    for (let i = 0; i < STATEMENT_MAX_ROWS + 3; i++)
      lines.push(`2026-10-01,Thing ${i},-1.00`);
    const read = readStatement(lines.join("\n"));
    if (!read.ok) throw new Error("unread");
    expect(read.value.rows).toHaveLength(STATEMENT_MAX_ROWS);
    expect(read.value.overLimit).toBe(3);
  });
});

describe("merchant rules", () => {
  it("prefers the owners' rules, then the longest built-in match", () => {
    expect(guessCategory("NYC PARKS PERMIT", [])).toBe("fields_permits");
    expect(guessCategory("Example Tavern deposit", [])).toBe("events");
    expect(
      guessCategory("Example Tavern deposit", [
        { pattern: "example tavern", category: "sponsor_costs" },
      ]),
    ).toBe("sponsor_costs");
    expect(guessCategory("Something else", [])).toBeNull();
  });

  it("keeps built-in patterns lowercase so they can match", () => {
    for (const r of BUILT_IN_RULES)
      expect(r.pattern).toBe(r.pattern.toLowerCase());
  });

  it("stores patterns lowercase and trimmed, between 2 and 60 letters", () => {
    expect(rulePattern("  Example   Tavern ")).toEqual({
      ok: true,
      value: "example tavern",
    });
    expect(rulePattern("x").ok).toBe(false);
    expect(rulePattern("x".repeat(61)).ok).toBe(false);
  });
});

const refPay: RecurringCost = {
  id: "ref",
  label: "Ref pay",
  category: "refs",
  amountCents: 12000,
  cadence: "game_day",
  startsOn: "2026-09-10",
};
const permit: RecurringCost = {
  id: "permit",
  label: "Field permit",
  category: "fields_permits",
  amountCents: 45000,
  cadence: "season",
  startsOn: "2026-01-01",
};
const season = { startsOn: "2026-09-01", endsOn: "2026-11-30" };
const gameDays = ["2026-09-06", "2026-09-13", "2026-09-13", "2026-09-20"];

describe("expectedCosts", () => {
  it("expects a season cost on the first day and game-day costs from their start", () => {
    const e = expectedCosts({
      costs: [refPay, permit],
      season,
      gameDays,
      settled: new Set(),
      today: "2026-09-14",
    });
    expect(e.due.map(occurrenceKey)).toEqual([
      "permit|2026-09-01",
      "ref|2026-09-13",
    ]);
    expect(e.next.map(occurrenceKey)).toEqual(["ref|2026-09-20"]);
  });

  it("leaves out what was confirmed or skipped", () => {
    const e = expectedCosts({
      costs: [refPay, permit],
      season,
      gameDays,
      settled: new Set(["permit|2026-09-01", "ref|2026-09-13"]),
      today: "2026-09-30",
    });
    expect(e.due.map(occurrenceKey)).toEqual(["ref|2026-09-20"]);
    expect(e.next).toEqual([]);
  });

  it("keeps a confirmed season cost settled when the season's first day moves", () => {
    const e = expectedCosts({
      costs: [permit],
      season: { ...season, startsOn: "2026-09-08" },
      gameDays,
      settled: new Set(["permit|2026-09-01"]),
      today: "2026-09-30",
    });
    expect(e.due).toEqual([]);
  });

  it("follows the schedule: a moved game day is expected on its new day", () => {
    const e = expectedCosts({
      costs: [refPay],
      season,
      // The September 13 games moved to the 14th before anyone confirmed.
      gameDays: ["2026-09-14", "2026-09-20"],
      settled: new Set(),
      today: "2026-09-30",
    });
    expect(e.due.map((o) => o.dueOn)).toEqual(["2026-09-14", "2026-09-20"]);
  });

  it("leaves game-day ref pay to the pay sheet when the season has a ref fee", () => {
    const input = {
      costs: [refPay, { ...refPay, id: "bar", category: "events" as const }],
      season,
      gameDays,
      settled: new Set<string>(),
      today: "2026-09-14",
    };
    expect(
      expectedCosts({ ...input, refsFromPaySheet: true }).due.map(
        (o) => o.costId,
      ),
    ).toEqual(["bar"]);
    expect(expectedCosts(input).due.map((o) => o.costId)).toEqual([
      "ref",
      "bar",
    ]);
  });

  it("doesn't expect a season cost in a season over before it started", () => {
    const e = expectedCosts({
      costs: [{ ...permit, startsOn: "2027-01-01" }],
      season,
      gameDays,
      settled: new Set(),
      today: "2026-12-01",
    });
    expect(e.due).toEqual([]);
  });

  it("lists each due occurrence once, oldest first, never one after today", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 28 }), { maxLength: 20 }),
        fc.integer({ min: 1, max: 28 }),
        (days, todayDay) => {
          const pad = (d: number) => `2026-10-${String(d).padStart(2, "0")}`;
          const today = pad(todayDay);
          const e = expectedCosts({
            costs: [{ ...refPay, startsOn: "2026-10-01" }],
            season: { startsOn: "2026-10-01", endsOn: "2026-10-31" },
            gameDays: days.map(pad),
            settled: new Set(),
            today,
          });
          const due = e.due.map((o) => o.dueOn);
          expect(new Set(due).size).toBe(due.length);
          expect([...due].sort()).toEqual(due);
          expect(due.every((d) => d <= today)).toBe(true);
          expect(e.next.every((o) => o.dueOn > today)).toBe(true);
        },
      ),
    );
  });
});

describe("forms", () => {
  it.each([
    ["45", 4500],
    ["45.5", 4550],
    ["$1,200", 120000],
    [" 12.30 ", 1230],
    ["0.07", 7],
    ["12.345", null],
    ["-5", null],
    ["", null],
  ])("reads the typed amount %j as %s cents", (text, cents) => {
    expect(typedCents(text)).toBe(cents);
  });

  it("refuses a day that doesn't exist", () => {
    expect(isDay("2026-02-28")).toBe(true);
    expect(isDay("2026-02-30")).toBe(false);
    expect(isDay("2026-13-01")).toBe(false);
  });

  it("treats an unknown receipt choice as 'add it later'", () => {
    expect(receiptChoice("none")).toBe("none");
    expect(receiptChoice("anything")).toBe("later");
  });

  it("reads an expected cost", () => {
    expect(
      parseRecurringForm({
        label: "  Ref   pay ",
        amount: "120",
        category: "refs",
        cadence: "game_day",
        startsOn: "2026-09-01",
      }),
    ).toEqual({
      ok: true,
      value: {
        label: "Ref pay",
        amountCents: 12000,
        category: "refs",
        cadence: "game_day",
        startsOn: "2026-09-01",
      },
    });
    expect(
      parseRecurringForm({
        label: "Ref pay",
        amount: "120",
        category: "refs",
        cadence: "weekly",
        startsOn: "2026-09-01",
      }),
    ).toEqual({ ok: false, error: "cadence" });
  });
});

describe("owed and the nudge", () => {
  it("sums what each person fronted, most owed first", () => {
    expect(
      owedByPerson([
        { id: "a", paidBy: "u1", amountCents: 2000 },
        { id: "b", paidBy: "u2", amountCents: 24000 },
        { id: "c", paidBy: "u1", amountCents: 500 },
      ]),
    ).toEqual([
      { paidBy: "u2", cents: 24000, expenseIds: ["b"] },
      { paidBy: "u1", cents: 2500, expenseIds: ["a", "c"] },
    ]);
  });

  it("nudges in a month's first week only, keyed by month", () => {
    expect(nudgeMonth("2026-11-01")).toBe("2026-11");
    expect(nudgeMonth("2026-11-07")).toBe("2026-11");
    expect(nudgeMonth("2026-11-08")).toBeNull();
    expect(nudgeKey("2026-11", "u1")).toBe("books_nudge:2026-11:u1");
  });
});
