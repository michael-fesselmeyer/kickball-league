import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type Column,
  centsToAmount,
  csvCell,
  exportFilename,
  toCsv,
} from "./csv";

/** A small RFC 4180 reader, to check that what we write reads back. */
function parseCsv(text: string): string[][] {
  const body = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" && body[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += ch;
  }
  return rows;
}

describe("csvCell", () => {
  it("writes plain text, numbers and empty cells as they are", () => {
    expect(csvCell("Robin Example")).toBe("Robin Example");
    expect(csvCell(42)).toBe("42");
    expect(csvCell(-3.5)).toBe("-3.5");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(Number.NaN)).toBe("");
    expect(csvCell(true)).toBe("yes");
    expect(csvCell(false)).toBe("no");
    expect(csvCell(new Date("2027-04-05T18:30:00Z"))).toBe(
      "2027-04-05T18:30:00.000Z",
    );
  });

  it("quotes separators, quotes and line breaks", () => {
    expect(csvCell("Smith, Jr.")).toBe('"Smith, Jr."');
    expect(csvCell('The "Kicks"')).toBe('"The ""Kicks"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell("two\r\nlines")).toBe('"two\r\nlines"');
    expect(csvCell(" padded ")).toBe('" padded "');
  });

  it.each([
    ["=1+1", "'=1+1"],
    [
      '=HYPERLINK("http://example.test","click")',
      `"'=HYPERLINK(""http://example.test"",""click"")"`,
    ],
    ["+15551234567", "'+15551234567"],
    ["-2+3", "'-2+3"],
    ["@SUM(A1:A2)", "'@SUM(A1:A2)"],
    ["\t=1+1", "'\t=1+1"],
    ["\r=1+1", '"\'\r=1+1"'],
    ["=cmd|' /C calc'!A0", "'=cmd|' /C calc'!A0"],
  ])("defuses a text cell that starts a formula: %j", (input, written) => {
    expect(csvCell(input)).toBe(written);
  });

  it("leaves a formula character alone when it is not first", () => {
    expect(csvCell("a=b")).toBe("a=b");
    expect(csvCell("Kick-Starters")).toBe("Kick-Starters");
    expect(csvCell("robin@example.test")).toBe("robin@example.test");
  });

  it("never lets a text cell start with a formula character", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const written = csvCell(text);
        const content = written.startsWith('"') ? written.slice(1) : written;
        expect(content).not.toMatch(/^[=+\-@\t\r]/);
      }),
    );
  });
});

describe("toCsv", () => {
  type Person = { name: string; paid: boolean; cents: number | null };
  const columns: Column<Person>[] = [
    { header: "Name", value: (p) => p.name },
    { header: "Paid", value: (p) => p.paid },
    {
      header: "Amount",
      value: (p) => (p.cents === null ? null : centsToAmount(p.cents)),
    },
  ];

  it("writes a header and one CRLF line per row, after a byte order mark", () => {
    const text = toCsv(columns, [
      { name: "Robin Example", paid: true, cents: 4500 },
      { name: "Sam, the Kicker", paid: false, cents: null },
    ]);
    expect(text).toBe(
      '﻿Name,Paid,Amount\r\nRobin Example,yes,45.00\r\n"Sam, the Kicker",no,\r\n',
    );
  });

  it("writes only the header for no rows", () => {
    expect(toCsv(columns, [])).toBe("﻿Name,Paid,Amount\r\n");
  });

  it("reads back to the same cells, apart from the defusing apostrophe", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: fc.string(),
            paid: fc.boolean(),
            cents: fc.option(fc.integer({ min: 0, max: 10_000_000 }), {
              nil: null,
            }),
          }),
        ),
        (people) => {
          const read = parseCsv(toCsv(columns, people));
          expect(read[0]).toEqual(["Name", "Paid", "Amount"]);
          expect(read.slice(1)).toEqual(
            people.map((p) => [
              /^[=+\-@\t\r]/.test(p.name) ? `'${p.name}` : p.name,
              p.paid ? "yes" : "no",
              p.cents === null ? "" : centsToAmount(p.cents),
            ]),
          );
        },
      ),
    );
  });
});

describe("centsToAmount", () => {
  it("writes two decimal places", () => {
    expect(centsToAmount(0)).toBe("0.00");
    expect(centsToAmount(5)).toBe("0.05");
    expect(centsToAmount(4500)).toBe("45.00");
    expect(centsToAmount(120_099)).toBe("1200.99");
    expect(centsToAmount(-250)).toBe("-2.50");
  });
});

describe("exportFilename", () => {
  it("joins safe parts", () => {
    expect(exportFilename(["Spring 2027", "roster"], "csv")).toBe(
      "spring-2027-roster.csv",
    );
    expect(exportFilename(["Señor Kicks!", "payments"], "csv")).toBe(
      "senor-kicks-payments.csv",
    );
    expect(exportFilename(["../../etc", "passwd"], "json")).toBe(
      "etc-passwd.json",
    );
    expect(exportFilename(["", "!!!"], "csv")).toBe("export.csv");
  });
});
