import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  bestOfOr,
  checkDodgeballScore,
  DEFAULT_BEST_OF,
  isBestOf,
  setsToWin,
} from "./dodgeball";
import { PLAYOFF_TIE, type ScoreInput } from "./result";

const score = (
  scoreA: number,
  scoreB: number,
  outcome: ScoreInput["outcome"] = "normal",
): ScoreInput => ({ outcome, scoreA, scoreB, inningsPlayed: null });

describe("match length", () => {
  it("is odd, 1 to 9, and 5 when the rule set doesn't say", () => {
    expect([1, 3, 5, 7, 9].every(isBestOf)).toBe(true);
    expect([0, 2, 4, 11, -1, 2.5].some(isBestOf)).toBe(false);
    expect(bestOfOr(null)).toBe(DEFAULT_BEST_OF);
    expect(bestOfOr(4)).toBe(DEFAULT_BEST_OF);
    expect(bestOfOr(3)).toBe(3);
    expect([1, 3, 5, 7, 9].map(setsToWin)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("checkDodgeballScore", () => {
  it("takes a match played to the end with one winner of a majority", () => {
    expect(checkDodgeballScore(score(3, 1))).toEqual({});
    expect(checkDodgeballScore(score(0, 3))).toEqual({});
    expect(checkDodgeballScore(score(2, 1), { bestOf: 3 })).toEqual({});
  });

  it("refuses a finished match without exactly one winner", () => {
    for (const [a, b] of [
      [2, 1],
      [3, 3],
      [0, 0],
    ] as const)
      expect(checkDodgeballScore(score(a, b)).scoreB).toBe(
        "A match played to the end has one winner of 3 sets (best of 5).",
      );
  });

  it("refuses more sets than a match can hold", () => {
    expect(checkDodgeballScore(score(4, 1))).toEqual({
      scoreA: "Enter sets from 0 to 3.",
    });
    expect(checkDodgeballScore(score(-1, 1.5))).toEqual({
      scoreA: "Enter sets from 0 to 3.",
      scoreB: "Enter sets from 0 to 3.",
    });
  });

  it("counts a called match as it stands, a level one as a tie", () => {
    expect(checkDodgeballScore(score(2, 1, "called"))).toEqual({});
    expect(checkDodgeballScore(score(1, 1, "called"))).toEqual({});
    expect(
      checkDodgeballScore(score(1, 1, "called"), { tiesAllowed: false }),
    ).toEqual({ scoreB: PLAYOFF_TIE });
  });

  it("refuses a called match that was already won, or had no set", () => {
    expect(checkDodgeballScore(score(3, 1, "called")).scoreB).toMatch(
      /Played to the end/,
    );
    expect(checkDodgeballScore(score(0, 0, "called")).scoreB).toMatch(
      /before any set/,
    );
  });

  it("ignores the sets of a forfeit", () => {
    expect(checkDodgeballScore(score(9, 9, "forfeit_a"))).toEqual({});
  });

  it("never takes a finished match that is a tie, at any length", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(1, 3, 5, 7, 9),
        fc.nat(9),
        fc.nat(9),
        (bestOf, a, b) => {
          const ok =
            Object.keys(checkDodgeballScore(score(a, b), { bestOf })).length ===
            0;
          const need = setsToWin(bestOf);
          expect(ok).toBe(
            Math.max(a, b) === need && Math.min(a, b) < need && a !== b,
          );
        },
      ),
    );
  });
});
