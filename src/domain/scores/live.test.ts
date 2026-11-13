import { describe, expect, it } from "vitest";
import {
  calledScore,
  checkHalf,
  type HalfInning,
  lineScore,
  MAX_INNINGS,
  ordinal,
  positionLabel,
  sideFor,
} from "./live";

/** Halves in order from runs listed top, bottom, top, bottom… */
const play = (...runs: number[]): HalfInning[] =>
  runs.map((r, i) => ({
    inning: Math.floor(i / 2) + 1,
    half: i % 2 === 0 ? "top" : "bottom",
    runs: r,
  }));

describe("sideFor", () => {
  it("puts the team that kicks first in the top of every inning", () => {
    expect(sideFor("top", "A")).toBe("A");
    expect(sideFor("bottom", "A")).toBe("B");
    expect(sideFor("top", "B")).toBe("B");
    expect(sideFor("bottom", "B")).toBe("A");
  });
});

describe("lineScore", () => {
  it("is empty before the first kick, with the top of the 1st next", () => {
    expect(lineScore([], "A")).toEqual({
      innings: [],
      totalA: 0,
      totalB: 0,
      completeInnings: 0,
      last: null,
      next: { inning: 1, half: "top" },
    });
  });

  it("lays out runs per team and inning with running totals", () => {
    const line = lineScore(play(1, 0, 2, 3, 0), "A");
    expect(line.innings).toEqual([
      { inning: 1, a: 1, b: 0 },
      { inning: 2, a: 2, b: 3 },
      { inning: 3, a: 0, b: null },
    ]);
    expect(line.totalA).toBe(3);
    expect(line.totalB).toBe(3);
    expect(line.completeInnings).toBe(2);
    expect(line.last).toEqual({ inning: 3, half: "top" });
    expect(line.next).toEqual({ inning: 3, half: "bottom" });
  });

  it("credits team B in the top when B kicks first", () => {
    const line = lineScore(play(4, 1), "B");
    expect(line.innings).toEqual([{ inning: 1, a: 1, b: 4 }]);
    expect(line.totalA).toBe(1);
    expect(line.totalB).toBe(4);
  });

  it("does not depend on the order the halves arrive in", () => {
    const halves = play(1, 2, 3, 4);
    expect(lineScore([...halves].reverse(), "A")).toEqual(
      lineScore(halves, "A"),
    );
  });

  it("has no next half once the last possible inning is in", () => {
    const all = play(...Array.from({ length: MAX_INNINGS * 2 }, () => 0));
    const line = lineScore(all, "A");
    expect(line.completeInnings).toBe(MAX_INNINGS);
    expect(line.next).toBeNull();
  });
});

describe("calledScore (rulebook 3.1.5)", () => {
  it("reverts to the score at the last complete inning", () => {
    // Five complete innings, then 4 runs in the top of the 6th before the
    // rain came: those 4 do not count.
    const halves = play(1, 0, 0, 2, 1, 1, 0, 0, 2, 0, 4);
    expect(lineScore(halves, "A").totalA).toBe(8);
    expect(calledScore(halves, "A")).toEqual({
      scoreA: 4,
      scoreB: 3,
      inningsPlayed: 5,
    });
  });

  it("keeps every run when the game is called between innings", () => {
    expect(calledScore(play(1, 0, 0, 2, 1, 1, 0, 0), "A")).toEqual({
      scoreA: 2,
      scoreB: 3,
      inningsPlayed: 4,
    });
  });

  it("drops a bottom half's runs too when the inning is not complete", () => {
    // B kicks first, so the top is B's. The 5th has only B's half in.
    expect(calledScore(play(0, 1, 2, 0, 0, 0, 1, 1, 3), "B")).toEqual({
      scoreA: 2,
      scoreB: 3,
      inningsPlayed: 4,
    });
  });

  it("is not a result before 4 complete innings", () => {
    expect(calledScore(play(1, 0, 0, 2, 1, 1, 5), "A")).toBeNull();
    expect(calledScore([], "A")).toBeNull();
  });
});

describe("checkHalf", () => {
  const two = play(1, 0, 2);

  it("accepts the next half in order", () => {
    expect(checkHalf(two, { inning: 2, half: "bottom", runs: 3 }, "A")).toBe(
      null,
    );
    expect(checkHalf([], { inning: 1, half: "top", runs: 0 }, "A")).toBe(null);
  });

  it("accepts a correction to any half already entered", () => {
    expect(checkHalf(two, { inning: 1, half: "top", runs: 5 }, "A")).toBe(null);
  });

  it("refuses a half that skips ahead", () => {
    expect(checkHalf(two, { inning: 3, half: "top", runs: 1 }, "A")).toBe(
      "out_of_order",
    );
    expect(checkHalf([], { inning: 1, half: "bottom", runs: 1 }, "A")).toBe(
      "out_of_order",
    );
  });

  it("refuses runs or innings out of range", () => {
    for (const entry of [
      { inning: 2, half: "bottom" as const, runs: -1 },
      { inning: 2, half: "bottom" as const, runs: 1.5 },
      { inning: 2, half: "bottom" as const, runs: 100 },
      { inning: 0, half: "top" as const, runs: 1 },
      { inning: MAX_INNINGS + 1, half: "top" as const, runs: 1 },
      // A half from a tampered form, as the server would receive it.
      JSON.parse('{ "inning": 2, "half": "middle", "runs": 1 }') as HalfInning,
    ])
      expect(checkHalf(two, entry, "A")).toBe("invalid");
  });

  it("keeps a team's total within what a final score can hold", () => {
    const big = play(60, 0);
    expect(checkHalf(big, { inning: 2, half: "top", runs: 39 }, "A")).toBe(
      null,
    );
    expect(checkHalf(big, { inning: 2, half: "top", runs: 40 }, "A")).toBe(
      "too_many_runs",
    );
    // A correction replaces the old runs instead of adding to them.
    expect(checkHalf(big, { inning: 1, half: "top", runs: 99 }, "A")).toBe(
      null,
    );
  });
});

describe("labels", () => {
  it("names innings the way people say them", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
    ]);
    expect(positionLabel({ inning: 4, half: "top" })).toBe("Top of the 4th");
    expect(positionLabel({ inning: 1, half: "bottom" })).toBe(
      "Bottom of the 1st",
    );
  });
});
