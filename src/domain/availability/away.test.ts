import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  availabilityFor,
  isIsoDate,
  isWeek,
  type Member,
  newlyShort,
  nextAwayWeeks,
  seasonWeeks,
  weekLabel,
  weekOf,
} from "./away";

const date = fc
  .integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2035, 11, 31) })
  .map((ms) => new Date(ms).toISOString().slice(0, 10));

/** Six women and six men, then a player with no side. */
const roster: Member[] = [
  ...Array.from({ length: 6 }, (_, i) => ({
    userId: `w${i}`,
    name: `W${i}`,
    side: "woman" as const,
  })),
  ...Array.from({ length: 6 }, (_, i) => ({
    userId: `m${i}`,
    name: `M${i}`,
    side: "man" as const,
  })),
  { userId: "n0", name: "N0", side: null },
];
const away = (entries: [string, string[]][]) =>
  new Map(entries.map(([id, weeks]) => [id, new Set(weeks)]));

describe("weeks", () => {
  it("names a week by its Monday, Sunday included in the week before", () => {
    expect(weekOf("2026-10-05")).toBe("2026-10-05"); // Monday
    expect(weekOf("2026-10-07")).toBe("2026-10-05");
    expect(weekOf("2026-10-11")).toBe("2026-10-05"); // Sunday
    expect(weekOf("2026-10-12")).toBe("2026-10-12");
    expect(weekOf("2027-01-01")).toBe("2026-12-28"); // across a year
  });

  it("puts every date in the week of a Monday at most six days before", () => {
    fc.assert(
      fc.property(date, (d) => {
        const week = weekOf(d);
        expect(isWeek(week)).toBe(true);
        const gap = (Date.parse(d) - Date.parse(week)) / 86_400_000;
        expect(gap).toBeGreaterThanOrEqual(0);
        expect(gap).toBeLessThanOrEqual(6);
      }),
    );
  });

  it("lists a season's weeks, one a week, covering both ends", () => {
    expect(seasonWeeks("2026-09-02", "2026-09-21")).toEqual([
      "2026-08-31",
      "2026-09-07",
      "2026-09-14",
      "2026-09-21",
    ]);
    fc.assert(
      fc.property(date, fc.integer({ min: 0, max: 200 }), (start, days) => {
        const end = new Date(Date.parse(start) + days * 86_400_000)
          .toISOString()
          .slice(0, 10);
        const weeks = seasonWeeks(start, end);
        expect(weeks[0]).toBe(weekOf(start));
        expect(weeks.at(-1)).toBe(weekOf(end));
        expect(weeks.every(isWeek)).toBe(true);
      }),
    );
  });

  it("checks dates and labels a week", () => {
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-10-5")).toBe(false);
    expect(isWeek("2026-10-06")).toBe(false);
    expect(weekLabel("2026-10-05")).toBe("Oct 5 – Oct 11");
  });
});

describe("availabilityFor", () => {
  it("counts who is left and checks the fielding rule", () => {
    const full = availabilityFor(roster, away([]), "2026-10-05");
    expect(full).toMatchObject({ available: 13, short: false, away: [] });
    const week = availabilityFor(
      roster,
      away([
        ["w0", ["2026-10-05"]],
        ["w1", ["2026-10-05"]],
        ["m0", ["2026-10-12"]],
      ]),
      "2026-10-05",
    );
    expect(week.available).toBe(11);
    expect(week.away.map((m) => m.name)).toEqual(["W0", "W1"]);
    // Four women and six men field ten, short of eleven.
    expect(week.short).toBe(true);
    expect(week.fielding.fielders).toBe(10);
  });

  it("splits the roster into away and available", () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), {
          minLength: roster.length,
          maxLength: roster.length,
        }),
        (flags) => {
          const marks = away(
            roster.flatMap((m, i): [string, string[]][] =>
              flags[i] ? [[m.userId, ["2026-10-05"]]] : [],
            ),
          );
          const week = availabilityFor(roster, marks, "2026-10-05");
          expect(week.available + week.away.length).toBe(roster.length);
          expect(week.short).toBe(week.fielding.level !== "full");
        },
      ),
    );
  });
});

describe("newlyShort", () => {
  it("finds the weeks a change takes from full to short", () => {
    const before = away([["w0", ["2026-10-05"]]]);
    const after = away([
      ["w0", ["2026-10-05", "2026-10-12"]],
      ["w1", ["2026-10-05"]],
    ]);
    // One woman away still fields eleven (5 and 6); two away do not.
    expect(
      newlyShort(roster, before, after, ["2026-10-05", "2026-10-12"]),
    ).toEqual(["2026-10-05"]);
  });

  it("ignores weeks that were already short or have no game", () => {
    const before = away([
      ["w0", ["2026-10-05"]],
      ["w1", ["2026-10-05"]],
    ]);
    const after = away([
      ["w0", ["2026-10-05", "2026-10-19"]],
      ["w1", ["2026-10-05", "2026-10-19"]],
      ["w2", ["2026-10-05"]],
    ]);
    expect(newlyShort(roster, before, after, ["2026-10-05"])).toEqual([]);
  });

  it("never reports a week that was short before the change", () => {
    fc.assert(
      fc.property(
        fc.subarray(roster.map((m) => m.userId)),
        fc.subarray(roster.map((m) => m.userId)),
        (wasAway, isAway) => {
          const week = "2026-10-05";
          const before = away(wasAway.map((id) => [id, [week]]));
          const after = away(isAway.map((id) => [id, [week]]));
          const found = newlyShort(roster, before, after, [week]);
          if (availabilityFor(roster, before, week).short)
            expect(found).toEqual([]);
        },
      ),
    );
  });
});

describe("nextAwayWeeks", () => {
  const weeks = seasonWeeks("2026-09-07", "2026-11-02");

  it("keeps weeks already gone and takes the form for the rest", () => {
    expect(
      nextAwayWeeks(
        ["2026-09-14", "2026-10-19"],
        ["2026-10-26", "2026-09-21"],
        weeks,
        "2026-10-05",
      ),
    ).toEqual(["2026-09-14", "2026-10-26"]);
  });

  it("drops anything outside the season or not a Monday", () => {
    expect(
      nextAwayWeeks(
        [],
        ["2027-01-04", "2026-10-13", "nope", "2026-10-12"],
        weeks,
        "2026-10-05",
      ),
    ).toEqual(["2026-10-12"]);
  });
});
