import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isoWeekday } from "./deals";
import { reportStart, weekLabel, weekOf, weeklyReport } from "./report";

// 2026-11-12 is a Thursday; its week starts Monday 2026-11-09.
const TODAY = "2026-11-12";

describe("weeks", () => {
  it("start on the Monday on or before a day", () => {
    expect(weekOf(TODAY)).toBe("2026-11-09");
    expect(weekOf("2026-11-09")).toBe("2026-11-09");
    expect(weekOf("2026-11-15")).toBe("2026-11-09");
    expect(weekOf("2026-11-16")).toBe("2026-11-16");
    // Across a month and a year.
    expect(weekOf("2027-01-01")).toBe("2026-12-28");
  });

  it("always land on a Monday no more than six days back", () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date("2020-01-01T00:00:00Z"),
          max: new Date("2035-12-31T00:00:00Z"),
          noInvalidDate: true,
        }),
        (d) => {
          const day = d.toISOString().slice(0, 10);
          const monday = weekOf(day);
          expect(isoWeekday(monday)).toBe(1);
          const gap =
            (Date.parse(`${day}T12:00:00Z`) -
              Date.parse(`${monday}T12:00:00Z`)) /
            86_400_000;
          expect(gap).toBeGreaterThanOrEqual(0);
          expect(gap).toBeLessThanOrEqual(6);
        },
      ),
    );
  });

  it("covers the asked number of weeks", () => {
    expect(reportStart(TODAY, 1)).toBe("2026-11-09");
    expect(reportStart(TODAY, 8)).toBe("2026-09-21");
  });

  it("read as the week of their Monday", () => {
    expect(weekLabel("2026-11-09")).toBe("Week of Nov 9");
  });
});

describe("the weekly report", () => {
  it("fills empty weeks with zeros, newest first", () => {
    const report = weeklyReport(
      [
        {
          weekOf: "2026-11-02",
          checkIns: 12,
          players: 10,
          teams: 3,
          dealsUsed: 7,
        },
      ],
      [],
      TODAY,
      3,
    );
    expect(report.weeks.map((w) => [w.weekOf, w.checkIns])).toEqual([
      ["2026-11-09", 0],
      ["2026-11-02", 12],
      ["2026-10-26", 0],
    ]);
    expect(report.totals).toEqual({ checkIns: 12, dealsUsed: 7 });
    expect(report.change).toBe(-12);
  });

  it("lists each week's deals, most used first", () => {
    const report = weeklyReport(
      [
        {
          weekOf: "2026-11-09",
          checkIns: 5,
          players: 5,
          teams: 2,
          dealsUsed: 4,
        },
      ],
      [
        { weekOf: "2026-11-09", dealId: "fries", count: 1 },
        { weekOf: "2026-11-09", dealId: "burger", count: 3 },
        { weekOf: "2026-11-02", dealId: "burger", count: 2 },
      ],
      TODAY,
      2,
    );
    expect(report.weeks[0]?.deals).toEqual([
      { dealId: "burger", count: 3 },
      { dealId: "fries", count: 1 },
    ]);
    expect(report.weeks[1]?.deals).toEqual([{ dealId: "burger", count: 2 }]);
  });

  it("has no change to report before anyone checks in", () => {
    expect(weeklyReport([], [], TODAY).change).toBeNull();
    expect(weeklyReport([], [], TODAY).weeks).toHaveLength(8);
  });
});
