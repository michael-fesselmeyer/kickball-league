import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  describeScore,
  halfDecision,
  halfName,
  halfResult,
  scoreStillCurrent,
  scoreVersion,
  withWaiting,
} from "./offline";
import { parseOfflineEntry } from "./offline-entry";

const KEY = "00000000-0000-4000-8000-000000000001";
const GAME = "00000000-0000-4000-8000-000000000002";
const USER = "00000000-0000-4000-8000-000000000003";
const base = {
  key: KEY,
  gameId: GAME,
  userId: USER,
  enteredAt: "2026-09-14T01:30:00.000Z",
};

describe("parseOfflineEntry", () => {
  it("reads each kind of entry", () => {
    const score = {
      ...base,
      kind: "score",
      version: "none",
      score: { outcome: "normal", scoreA: 5, scoreB: 3, inningsPlayed: null },
    };
    const half = {
      ...base,
      kind: "half",
      inning: 3,
      half: "top",
      runs: 2,
      was: null,
    };
    const end = { ...base, kind: "end", version: "none", ending: "called" };
    for (const entry of [score, half, end])
      expect(parseOfflineEntry(entry)).toEqual(entry);
  });

  it("drops fields it doesn't know, like the phone's own summary", () => {
    expect(
      parseOfflineEntry({
        ...base,
        kind: "end",
        version: "none",
        ending: "normal",
        summary: "Game over",
      }),
    ).not.toHaveProperty("summary");
  });

  it("refuses anything else", () => {
    const half = { ...base, kind: "half", inning: 1, half: "top", runs: 1 };
    for (const bad of [
      null,
      "score",
      { ...half, was: null, key: "not-a-uuid" },
      { ...half, was: null, runs: 100 },
      { ...half, was: null, runs: 1.5 },
      { ...half, was: null, inning: 0 },
      { ...half, was: null, half: "middle" },
      { ...half, was: -1 },
      { ...half, was: null, enteredAt: "yesterday" },
      { ...half, was: null, kind: "undo" },
      {
        ...base,
        kind: "score",
        version: "none",
        score: { outcome: "won", scoreA: 1, scoreB: 0, inningsPlayed: null },
      },
      { ...base, kind: "end", version: "none", ending: "rained_out" },
    ])
      expect(parseOfflineEntry(bad)).toBeNull();
  });
});

describe("scoreVersion", () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 8, 14, 1, minute));

  it("is 'none' before anyone reports", () => {
    expect(scoreVersion([], [])).toBe("none");
  });

  it("names the latest report and how many answers it has", () => {
    const reports = [
      { id: "r1", reportedAt: at(0) },
      { id: "r2", reportedAt: at(5) },
    ];
    expect(scoreVersion(reports, [])).toBe("r2:0");
    expect(scoreVersion(reports, [{ reportId: "r1" }])).toBe("r2:0");
    expect(scoreVersion(reports, [{ reportId: "r2" }])).toBe("r2:1");
  });

  it("changes whenever a report or an answer is added", () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat({ max: 1000 }), { minLength: 1, maxLength: 6 }),
        fc.nat({ max: 3 }),
        (minutes, answers) => {
          const reports = minutes.map((m, i) => ({
            id: `r${i}`,
            reportedAt: new Date(Date.UTC(2026, 8, 14) + m * 60_000 + i),
          }));
          const latest = reports.reduce((a, b) =>
            b.reportedAt > a.reportedAt ? b : a,
          );
          const responses = Array.from({ length: answers }, () => ({
            reportId: latest.id,
          }));
          const before = scoreVersion(reports, responses);
          const later = {
            id: "new",
            reportedAt: new Date(latest.reportedAt.getTime() + 1),
          };
          expect(scoreVersion([...reports, later], responses)).not.toBe(before);
          expect(
            scoreVersion(reports, [...responses, { reportId: latest.id }]),
          ).not.toBe(before);
        },
      ),
    );
  });

  it("lets a late score in only when nothing changed", () => {
    expect(scoreStillCurrent("none", "none")).toBe(true);
    expect(scoreStillCurrent("none", "r1:0")).toBe(false);
    expect(scoreStillCurrent("r1:0", "r1:1")).toBe(false);
  });
});

describe("halfDecision", () => {
  it("does nothing when the server already has these runs", () => {
    expect(halfDecision(3, { runs: 3, was: null })).toBe("same");
    expect(halfDecision(3, { runs: 3, was: 1 })).toBe("same");
  });

  it("applies the runs when the half is as the phone saw it", () => {
    expect(halfDecision(null, { runs: 2, was: null })).toBe("apply");
    expect(halfDecision(1, { runs: 2, was: 1 })).toBe("apply");
  });

  it("keeps someone else's runs saved there since", () => {
    expect(halfDecision(4, { runs: 2, was: null })).toBe("keep");
    expect(halfDecision(4, { runs: 2, was: 1 })).toBe("keep");
    // Taken back on the server since: the correction has nothing to fix.
    expect(halfDecision(null, { runs: 2, was: 1 })).toBe("keep");
  });

  it("never overwrites runs the phone didn't see", () => {
    fc.assert(
      fc.property(
        fc.option(fc.nat({ max: 99 })),
        fc.nat({ max: 99 }),
        fc.option(fc.nat({ max: 99 })),
        (current, runs, was) => {
          const decision = halfDecision(current, { runs, was });
          if (decision === "apply") expect(current).toBe(was);
          if (current === runs) expect(decision).toBe("same");
        },
      ),
    );
  });
});

describe("what the person is told", () => {
  const names = { A: "Aces", B: "Bees" };

  it("describes a score the way the score screen does", () => {
    const score = { scoreA: 5, scoreB: 3, inningsPlayed: null };
    expect(describeScore(names, { ...score, outcome: "normal" })).toBe(
      "Aces 5, Bees 3",
    );
    expect(
      describeScore(names, { ...score, outcome: "called", inningsPlayed: 5 }),
    ).toBe("Aces 5, Bees 3 (called after 5 innings)");
    expect(describeScore(names, { ...score, outcome: "forfeit_b" })).toBe(
      "Bees forfeited",
    );
  });

  it("names the half", () => {
    expect(halfName(3, "top")).toBe("the top of the 3rd");
    expect(halfName(11, "bottom")).toBe("the bottom of the 11th");
  });

  it("explains each half-inning answer", () => {
    const entry = { inning: 2, half: "bottom" as const, runs: 1 };
    expect(halfResult(entry, "apply", null)).toEqual({
      status: "saved",
      message: "Saved 1 run in the bottom of the 2nd.",
    });
    expect(halfResult(entry, "same", 1)).toEqual({
      status: "unchanged",
      message: "The bottom of the 2nd already had 1 run.",
    });
    expect(halfResult(entry, "keep", 4)).toEqual({
      status: "kept",
      message:
        "Someone else saved 4 runs in the bottom of the 2nd first, so yours (1) wasn't used.",
    });
    expect(halfResult(entry, "keep", null).message).toContain("no runs");
  });
});

describe("withWaiting", () => {
  const waitingHalf = (
    inning: number,
    half: "top" | "bottom",
    runs: number,
  ) => ({
    ...base,
    kind: "half" as const,
    inning,
    half,
    runs,
    was: null,
  });

  it("adds waiting halves after the server's, and corrections in place", () => {
    expect(
      withWaiting(
        [{ inning: 1, half: "top", runs: 1 }],
        [
          waitingHalf(1, "bottom", 2),
          waitingHalf(2, "top", 0),
          waitingHalf(1, "top", 3),
          { ...base, kind: "end", version: "none", ending: "normal" },
        ],
      ),
    ).toEqual([
      { inning: 1, half: "top", runs: 3 },
      { inning: 1, half: "bottom", runs: 2 },
      { inning: 2, half: "top", runs: 0 },
    ]);
  });

  it("lets a later entry for the same half win", () => {
    expect(
      withWaiting([], [waitingHalf(1, "top", 1), waitingHalf(1, "top", 4)]),
    ).toEqual([{ inning: 1, half: "top", runs: 4 }]);
  });
});
