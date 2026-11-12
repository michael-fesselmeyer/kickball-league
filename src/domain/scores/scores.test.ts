import { describe, expect, it } from "vitest";
import {
  checkScore,
  PLAYOFF_TIE,
  type Report,
  respondingTeams,
  scoreState,
} from "./scores";

const T = ["home", "away"] as const;
const at = (h: number) => new Date(Date.UTC(2027, 3, 5, h));
const report = (change: Partial<Report> = {}): Report => ({
  id: "r1",
  role: "captain",
  teamSeasonId: "home",
  reportedAt: at(2),
  ...change,
});

describe("checkScore", () => {
  it("accepts a normal score and needs innings only for a called game", () => {
    expect(
      checkScore({
        outcome: "normal",
        scoreA: 5,
        scoreB: 3,
        inningsPlayed: null,
      }),
    ).toEqual({});
    expect(
      checkScore({ outcome: "called", scoreA: 5, scoreB: 3, inningsPlayed: 4 }),
    ).toEqual({});
    expect(
      checkScore({ outcome: "called", scoreA: 5, scoreB: 3, inningsPlayed: 3 }),
    ).toHaveProperty("inningsPlayed");
    expect(
      checkScore({
        outcome: "called",
        scoreA: 5,
        scoreB: 3,
        inningsPlayed: null,
      }),
    ).toHaveProperty("inningsPlayed");
    expect(
      checkScore({
        outcome: "called",
        scoreA: 5,
        scoreB: 3,
        inningsPlayed: 21,
      }),
    ).toHaveProperty("inningsPlayed");
  });

  it("refuses impossible runs, but ignores runs on a forfeit", () => {
    expect(
      checkScore({
        outcome: "normal",
        scoreA: -1,
        scoreB: 100,
        inningsPlayed: null,
      }),
    ).toEqual({
      scoreA: "Enter runs from 0 to 99.",
      scoreB: "Enter runs from 0 to 99.",
    });
    expect(
      checkScore({
        outcome: "normal",
        scoreA: 1.5,
        scoreB: 0,
        inningsPlayed: null,
      }),
    ).toHaveProperty("scoreA");
    expect(
      checkScore({
        outcome: "forfeit_b",
        scoreA: -1,
        scoreB: -1,
        inningsPlayed: null,
      }),
    ).toEqual({});
  });
});

describe("scoreState", () => {
  it("has nothing to show before a report", () => {
    expect(scoreState([], [], T, at(3))).toEqual({ state: "none" });
  });

  it("waits for the other captain, then is final when they confirm", () => {
    expect(scoreState([report()], [], T, at(3))).toEqual({
      state: "awaiting",
      reportId: "r1",
      finalAt: at(26),
    });
    // The reporting team cannot confirm its own score.
    expect(
      scoreState(
        [report()],
        [{ reportId: "r1", teamSeasonId: "home", status: "confirmed" }],
        T,
        at(3),
      ).state,
    ).toBe("awaiting");
    expect(
      scoreState(
        [report()],
        [{ reportId: "r1", teamSeasonId: "away", status: "confirmed" }],
        T,
        at(3),
      ),
    ).toEqual({ state: "final", reportId: "r1", reason: "confirmed" });
  });

  it("becomes final after 24 hours unless disputed", () => {
    expect(scoreState([report()], [], T, at(26))).toEqual({
      state: "final",
      reportId: "r1",
      reason: "time",
    });
    expect(
      scoreState(
        [report()],
        [{ reportId: "r1", teamSeasonId: "away", status: "disputed" }],
        T,
        at(30),
      ),
    ).toEqual({ state: "disputed", reportId: "r1" });
  });

  it("lets either captain confirm a ref's report, and makes an admin's final at once", () => {
    const ref = report({ role: "referee", teamSeasonId: null });
    expect(
      scoreState(
        [ref],
        [{ reportId: "r1", teamSeasonId: "home", status: "confirmed" }],
        T,
        at(3),
      ).state,
    ).toBe("final");
    expect(
      scoreState([report({ role: "admin", teamSeasonId: null })], [], T, at(2)),
    ).toEqual({
      state: "final",
      reportId: "r1",
      reason: "admin",
    });
  });

  it("follows the latest report, so a correction starts the clock again", () => {
    const first = report({ id: "r1", reportedAt: at(2) });
    const second = report({
      id: "r2",
      teamSeasonId: "away",
      reportedAt: at(5),
    });
    const responses = [
      { reportId: "r1", teamSeasonId: "away", status: "disputed" as const },
    ];
    expect(scoreState([second, first], responses, T, at(6))).toEqual({
      state: "awaiting",
      reportId: "r2",
      finalAt: at(29),
    });
  });
});

describe("respondingTeams", () => {
  it("is the other team, either team, or nobody", () => {
    expect(respondingTeams(report(), T)).toEqual(["away"]);
    expect(
      respondingTeams(report({ role: "referee", teamSeasonId: null }), T),
    ).toEqual(["home", "away"]);
    expect(
      respondingTeams(report({ role: "admin", teamSeasonId: null }), T),
    ).toEqual([]);
  });
});

describe("checkScore in the playoffs", () => {
  const tie = {
    outcome: "normal",
    scoreA: 4,
    scoreB: 4,
    inningsPlayed: null,
  } as const;
  it("refuses a tie when ties are not allowed", () => {
    expect(checkScore(tie, { tiesAllowed: false })).toEqual({
      scoreB: PLAYOFF_TIE,
    });
    expect(
      checkScore(
        { ...tie, outcome: "called", inningsPlayed: 5 },
        { tiesAllowed: false },
      ),
    ).toEqual({ scoreB: PLAYOFF_TIE });
  });
  it("still allows a tie in the regular season, and any forfeit", () => {
    expect(checkScore(tie)).toEqual({});
    expect(
      checkScore({ ...tie, outcome: "forfeit_a" }, { tiesAllowed: false }),
    ).toEqual({});
    expect(checkScore({ ...tie, scoreB: 5 }, { tiesAllowed: false })).toEqual(
      {},
    );
  });
});
