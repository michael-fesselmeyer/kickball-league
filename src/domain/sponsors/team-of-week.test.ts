import { describe, expect, it } from "vitest";
import type { StatGame } from "@/domain/stats/games";
import { suggestionReason, suggestTeamsOfWeek } from "./team-of-week";

const dayOf = (d: Date) => d.toISOString().slice(0, 10);
let n = 0;
const game = (
  day: string,
  teamA: string,
  scoreA: number,
  teamB: string,
  scoreB: number,
): StatGame => ({
  id: `g${++n}`,
  seasonId: "s",
  kind: "regular",
  playedAt: new Date(`${day}T23:00:00Z`),
  teamA,
  teamB,
  result: { kind: "played", scoreA, scoreB },
});

const TEAMS = ["aces", "bunts", "cleats", "dingers"];

describe("team of the week suggestions", () => {
  // Week one sets the order: aces, bunts, dingers (lost by 6), cleats (by 8).
  const weekOne = [
    game("2026-11-03", "aces", 10, "cleats", 2),
    game("2026-11-03", "bunts", 9, "dingers", 3),
  ];

  it("weighs beating a higher-ranked team against the size of a win", () => {
    const weekTwo = [
      game("2026-11-10", "dingers", 6, "aces", 5),
      game("2026-11-10", "bunts", 12, "cleats", 4),
    ];
    const picks = suggestTeamsOfWeek(
      TEAMS,
      [...weekOne, ...weekTwo],
      "2026-11-10",
      dayOf,
    );
    expect(picks.map((p) => [p.team, p.upset, p.score])).toEqual([
      // Second over fourth is no upset: 8 runs.
      ["bunts", false, 8],
      // Third over first: 1 run plus 2 for each of the 2 places.
      ["dingers", true, 5],
    ]);
    expect(picks.find((p) => p.team === "dingers")?.opponentRank).toBe(1);
  });

  it("puts a big enough upset first", () => {
    const weekTwo = [
      game("2026-11-10", "dingers", 9, "aces", 5),
      game("2026-11-10", "bunts", 8, "cleats", 4),
    ];
    const [first] = suggestTeamsOfWeek(
      TEAMS,
      [...weekOne, ...weekTwo],
      "2026-11-10",
      dayOf,
    );
    expect(first?.team).toBe("dingers");
  });

  it("skips ties, forfeits and other days", () => {
    const picks = suggestTeamsOfWeek(
      TEAMS,
      [
        game("2026-11-10", "aces", 4, "bunts", 4),
        {
          ...game("2026-11-10", "cleats", 0, "dingers", 0),
          result: { kind: "forfeit", forfeitBy: "cleats" },
        },
        game("2026-11-17", "aces", 9, "cleats", 1),
      ],
      "2026-11-10",
      dayOf,
    );
    expect(picks).toEqual([]);
  });

  it("writes a reason the admin can keep", () => {
    const [upset] = suggestTeamsOfWeek(
      TEAMS,
      [...weekOne, game("2026-11-10", "dingers", 9, "aces", 5)],
      "2026-11-10",
      dayOf,
    );
    expect(upset && suggestionReason(upset, "Aces")).toBe(
      "Took down No. 1 Aces, 9–5.",
    );
    const [close] = suggestTeamsOfWeek(
      TEAMS,
      [game("2026-11-10", "aces", 5, "bunts", 4)],
      "2026-11-10",
      dayOf,
    );
    expect(close && suggestionReason(close, "Bunts")).toBe(
      "Edged Bunts 5–4 in the day's tightest finish.",
    );
  });
});
