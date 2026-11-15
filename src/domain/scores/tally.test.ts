import { describe, expect, it } from "vitest";
import { MAX_RUNS } from "./scores";
import { addRun, parseTally, runsSoFar, tallyKey, undoStep } from "./tally";

const top3 = { inning: 3, half: "top" } as const;

describe("parseTally", () => {
  it("reads back a stored count", () => {
    expect(parseTally(JSON.stringify({ ...top3, runs: 2 }))).toEqual({
      ...top3,
      runs: 2,
    });
  });

  it("ignores nothing, junk and impossible counts", () => {
    for (const raw of [
      null,
      "",
      "not json",
      "null",
      "[]",
      JSON.stringify({ inning: 0, half: "top", runs: 1 }),
      JSON.stringify({ inning: 2, half: "middle", runs: 1 }),
      JSON.stringify({ inning: 2, half: "top", runs: -1 }),
      JSON.stringify({ inning: 2, half: "top", runs: 1.5 }),
      JSON.stringify({ inning: 2, half: "top", runs: MAX_RUNS + 1 }),
      JSON.stringify({ inning: "2", half: "top", runs: 1 }),
    ])
      expect(parseTally(raw)).toBeNull();
  });

  it("keeps each game's count apart", () => {
    expect(tallyKey("a")).not.toBe(tallyKey("b"));
  });
});

describe("runsSoFar", () => {
  it("counts the runs kept for the half being played", () => {
    expect(runsSoFar({ ...top3, runs: 4 }, top3)).toBe(4);
  });

  it("starts from 0 when the count was for another half", () => {
    expect(runsSoFar({ ...top3, runs: 4 }, { inning: 3, half: "bottom" })).toBe(
      0,
    );
    expect(runsSoFar({ ...top3, runs: 4 }, { inning: 4, half: "top" })).toBe(0);
    expect(runsSoFar(null, top3)).toBe(0);
    expect(runsSoFar({ ...top3, runs: 4 }, null)).toBe(0);
  });
});

describe("addRun", () => {
  it("adds one run to the half being played", () => {
    expect(addRun(top3, 0)).toEqual({ ...top3, runs: 1 });
    expect(addRun(top3, 4)).toEqual({ ...top3, runs: 5 });
  });

  it("stops at the most a half can hold", () => {
    expect(addRun(top3, MAX_RUNS).runs).toBe(MAX_RUNS);
  });
});

describe("undoStep", () => {
  const bottom2 = { inning: 2, half: "bottom", runs: 3 } as const;

  it("takes back the last +1 run while the half has any", () => {
    expect(undoStep(top3, 2, bottom2)).toEqual({
      kind: "run",
      tally: { ...top3, runs: 1 },
    });
  });

  it("reopens the last half, runs and all, right after End half", () => {
    expect(undoStep(top3, 0, bottom2)).toEqual({
      kind: "half",
      tally: { inning: 2, half: "bottom", runs: 3 },
    });
  });

  it("has nothing to take back before the first run or half", () => {
    expect(undoStep({ inning: 1, half: "top" }, 0, null)).toBeNull();
  });

  it("reopens the last half once every inning is in", () => {
    expect(undoStep(null, 0, bottom2)?.kind).toBe("half");
  });
});
