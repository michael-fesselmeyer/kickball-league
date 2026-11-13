import { describe, expect, it } from "vitest";
import {
  groupByDivision,
  parseCrossoverGames,
  parseDivisionName,
  parseRuleSet,
  ruleSetSummary,
} from "./divisions";

describe("division names", () => {
  it("tidies the name and makes a slug for the public pages", () => {
    expect(parseDivisionName("  Social   Fun ")).toEqual({
      ok: true,
      value: { name: "Social Fun", slug: "social-fun" },
    });
  });

  it("refuses a name with nothing to link to, or one too long", () => {
    expect(parseDivisionName(" !! ").ok).toBe(false);
    expect(parseDivisionName("x".repeat(41)).ok).toBe(false);
  });
});

describe("rule sets", () => {
  const form = {
    name: "Competitive",
    innings: "7",
    timeLimitMinutes: "",
    bunting: false,
    stealing: true,
  };

  it("keeps the limits that were given and leaves the rest open", () => {
    expect(parseRuleSet(form)).toEqual({
      ok: true,
      value: {
        name: "Competitive",
        innings: 7,
        timeLimitMinutes: null,
        bunting: false,
        stealing: true,
      },
    });
  });

  it("refuses a missing name or limits out of range", () => {
    expect(parseRuleSet({ ...form, name: " " })).toEqual({
      ok: false,
      error: "invalid_name",
    });
    for (const bad of [
      { innings: "0" },
      { innings: "2.5" },
      { timeLimitMinutes: "5" },
      { timeLimitMinutes: "abc" },
    ])
      expect(parseRuleSet({ ...form, ...bad })).toEqual({
        ok: false,
        error: "invalid_limits",
      });
  });

  it("reads as one line", () => {
    expect(
      ruleSetSummary({
        innings: 7,
        timeLimitMinutes: 55,
        options: { bunting: true, stealing: false },
      }),
    ).toBe("7 innings · 55-minute limit · bunting allowed · no stealing");
    expect(
      ruleSetSummary({
        innings: null,
        timeLimitMinutes: null,
        options: { bunting: false, stealing: true },
      }),
    ).toBe("no bunting · stealing allowed");
    expect(
      ruleSetSummary({ innings: null, timeLimitMinutes: null, options: {} }),
    ).toBe("");
  });
});

describe("crossover games", () => {
  it("takes 0 to 10, with an empty field as 0", () => {
    expect(parseCrossoverGames("")).toEqual({ ok: true, value: 0 });
    expect(parseCrossoverGames("3")).toEqual({ ok: true, value: 3 });
    for (const bad of ["-1", "11", "1.5", "two"])
      expect(parseCrossoverGames(bad).ok).toBe(false);
  });
});

describe("grouping teams by division", () => {
  const divisions = [{ id: "c" }, { id: "s" }];
  const teams = [
    { name: "A", divisionId: "s" },
    { name: "B", divisionId: "c" },
    { name: "C", divisionId: null },
    { name: "D", divisionId: "gone" },
  ];

  it("keeps the divisions' order and lists unassigned teams last", () => {
    expect(
      groupByDivision(divisions, teams).map((g) => [
        g.divisionId,
        g.teams.map((t) => t.name),
      ]),
    ).toEqual([
      ["c", ["B"]],
      ["s", ["A"]],
      [null, ["C", "D"]],
    ]);
  });

  it("leaves off the unassigned group when every team has a division", () => {
    expect(groupByDivision(divisions, teams.slice(0, 2))).toHaveLength(2);
  });

  it("is one group for a season without divisions", () => {
    expect(groupByDivision([], teams)).toEqual([{ divisionId: null, teams }]);
  });
});
