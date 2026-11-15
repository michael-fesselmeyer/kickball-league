import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/domain/export/csv";
import {
  countSizes,
  DEFAULT_SEASON_SIZES,
  expenseNote,
  NO_TEAM,
  parseOrderForm,
  parseSeasonSizes,
  pickSize,
  seasonSize,
  vendorColumns,
  vendorRows,
} from "./order";
import { SHIRT_SIZES, type ShirtSize } from "./summary";

describe("season sizes", () => {
  it("keeps the ticked sizes smallest first, and needs at least one", () => {
    expect(parseSeasonSizes(["xxxl", "m", "s", "nope"])).toEqual({
      ok: true,
      value: ["s", "m", "xxxl"],
    });
    expect(parseSeasonSizes([])).toEqual({ ok: false, error: "no_sizes" });
  });

  it("takes only a size the season offers from a sign-up form", () => {
    expect(pickSize("xl", DEFAULT_SEASON_SIZES)).toBe("xl");
    expect(pickSize("xxxl", DEFAULT_SEASON_SIZES)).toBeNull();
    expect(pickSize("huge", DEFAULT_SEASON_SIZES)).toBeNull();
    expect(pickSize(undefined, DEFAULT_SEASON_SIZES)).toBeNull();
  });

  it("counts a profile's size only when the season offers it", () => {
    expect(seasonSize("m", ["s", "m"])).toBe("m");
    expect(seasonSize("xs", ["s", "m"])).toBeNull();
    expect(seasonSize(null, ["s", "m"])).toBeNull();
  });
});

describe("countSizes", () => {
  it("counts each offered size and who still needs one", () => {
    expect(
      countSizes(
        [{ size: "m" }, { size: "m" }, { size: "xs" }, { size: null }],
        ["s", "m", "l"],
      ),
    ).toEqual({ bySize: { m: 2 }, missing: 2, total: 4 });
  });

  it("always adds up to everyone", () => {
    const size = fc.option(fc.constantFrom(...SHIRT_SIZES), { nil: null });
    fc.assert(
      fc.property(
        fc.array(fc.record({ size })),
        fc.subarray([...SHIRT_SIZES], { minLength: 1 }),
        (players, offered: ShirtSize[]) => {
          const c = countSizes(players, offered);
          const sized = Object.values(c.bySize).reduce((a, n) => a + n, 0);
          expect(sized + c.missing).toBe(players.length);
          for (const s of Object.keys(c.bySize)) expect(offered).toContain(s);
        },
      ),
    );
  });
});

describe("vendorRows", () => {
  const input = {
    teams: [
      {
        name: "Kick Ash",
        colorHex: "#FF6600",
        players: [
          { name: "Robin Example", size: "m" as const },
          { name: "Alex Sample", size: "m" as const },
          { name: "Jordan Other", size: "l" as const },
          { name: "Sam Nosize", size: null },
        ],
      },
    ],
    unplaced: [{ name: "Casey Free", size: "s" as const }],
    jerseys: [
      {
        name: "Robin Example",
        teamName: "Kick Ash",
        colorHex: "#FF6600",
        size: "m" as const,
        quantity: 1,
      },
      {
        name: "Alex Sample",
        teamName: "Kick Ash",
        colorHex: "#FF6600",
        size: "m" as const,
        quantity: 2,
      },
    ],
    offered: DEFAULT_SEASON_SIZES,
  };

  it("gives the vendor sizes and counts, with no names", () => {
    const rows = vendorRows(input, false);
    expect(rows).toEqual([
      {
        item: "Season shirt",
        team: "Kick Ash",
        color: "#FF6600",
        size: "M",
        quantity: 2,
        name: null,
      },
      {
        item: "Season shirt",
        team: "Kick Ash",
        color: "#FF6600",
        size: "L",
        quantity: 1,
        name: null,
      },
      {
        item: "Season shirt",
        team: NO_TEAM,
        color: null,
        size: "S",
        quantity: 1,
        name: null,
      },
      {
        item: "Replacement jersey",
        team: "Kick Ash",
        color: "#FF6600",
        size: "M",
        quantity: 3,
        name: null,
      },
    ]);
    const csv = toCsv(vendorColumns(false), rows);
    expect(csv).not.toContain("Robin");
    expect(csv.split("\r\n")[0]).toBe("﻿Item,Team,Team color,Size,Quantity");
  });

  it("names each player for team packing only when asked", () => {
    const rows = vendorRows(input, true);
    expect(rows.filter((r) => r.item === "Season shirt")).toHaveLength(4);
    expect(rows.map((r) => r.name)).toEqual([
      "Alex Sample",
      "Robin Example",
      "Jordan Other",
      "Casey Free",
      "Robin Example",
      "Alex Sample",
    ]);
    expect(toCsv(vendorColumns(true), rows).split("\r\n")[0]).toBe(
      "﻿Item,Team,Team color,Size,Quantity,Name",
    );
  });

  it("keeps a team name that looks like a formula as text", () => {
    const rows = vendorRows(
      {
        ...input,
        teams: [{ ...input.teams[0]!, name: "=HYPERLINK(1)" }],
        unplaced: [],
        jerseys: [],
      },
      false,
    );
    expect(csvCell(rows[0]?.team)).toBe("'=HYPERLINK(1)");
  });

  it("never counts more shirts than players with an offered size", () => {
    const size = fc.option(fc.constantFrom(...SHIRT_SIZES), { nil: null });
    fc.assert(
      fc.property(
        fc.array(fc.record({ name: fc.string(), size }), { maxLength: 30 }),
        (players) => {
          const rows = vendorRows(
            {
              teams: [{ name: "T", colorHex: null, players }],
              unplaced: [],
              jerseys: [],
              offered: DEFAULT_SEASON_SIZES,
            },
            false,
          );
          const shirts = rows.reduce((n, r) => n + r.quantity, 0);
          expect(shirts).toBe(
            players.filter((p) => seasonSize(p.size, DEFAULT_SEASON_SIZES))
              .length,
          );
        },
      ),
    );
  });
});

describe("parseOrderForm", () => {
  it("reads an optional cost and vendor", () => {
    expect(parseOrderForm({ cost: "812.50", vendor: " Ink Co " })).toEqual({
      ok: true,
      value: { costCents: 81_250, vendor: "Ink Co" },
    });
    expect(parseOrderForm({ cost: "", vendor: "" })).toEqual({
      ok: true,
      value: { costCents: null, vendor: null },
    });
  });

  it.each([["0"], ["abc"], ["100000.01"], ["-5"]])(
    "refuses a cost of %s",
    (cost) => {
      expect(parseOrderForm({ cost, vendor: "" })).toEqual({
        ok: false,
        error: "cost",
      });
    },
  );

  it("refuses a vendor name past 80 characters", () => {
    expect(parseOrderForm({ cost: "", vendor: "x".repeat(81) })).toEqual({
      ok: false,
      error: "vendor",
    });
  });
});

describe("expenseNote", () => {
  it("names the season and the vendor", () => {
    expect(expenseNote("Spring 2027", "Ink Co")).toBe(
      "Spring 2027 shirt order from Ink Co",
    );
    expect(expenseNote("Spring 2027", null)).toBe("Spring 2027 shirt order");
  });
});
