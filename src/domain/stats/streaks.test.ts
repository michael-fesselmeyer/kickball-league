import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type ResultGame, standings } from "@/domain/standings/standings";
import { forfeit, gamesArb, played, TEAMS } from "./games.fixture";
import type { StatGame } from "./games";
import {
  runs,
  streakLabel,
  streakNote,
  streaksOf,
  teamStreaks,
} from "./streaks";

const toResult = (g: StatGame): ResultGame =>
  g.result.kind === "played"
    ? {
        kind: "played",
        teamA: g.teamA,
        teamB: g.teamB,
        scoreA: g.result.scoreA,
        scoreB: g.result.scoreB,
      }
    : {
        kind: "forfeit",
        teamA: g.teamA,
        teamB: g.teamB,
        forfeitBy: g.result.forfeitBy,
      };

describe("streaks", () => {
  it("finds the current streak and the longest runs", () => {
    const games = [
      played("A", 5, "B", 3, 0),
      played("A", 6, "C", 1, 1),
      played("D", 4, "A", 2, 2),
      forfeit("A", "B", "B", 3),
      played("A", 3, "C", 3, 4),
      played("A", 9, "D", 0, 5),
      played("A", 8, "B", 7, 6),
    ];
    expect(streaksOf("A", games)).toEqual({
      team: "A",
      played: 7,
      current: { outcome: "W", length: 2 },
      longestWin: 2,
      longestLoss: 1,
    });
  });

  it("orders games by when they were played, not by input order", () => {
    const games = [played("A", 1, "B", 2, 2), played("A", 3, "B", 0, 1)];
    expect(streakLabel(streaksOf("A", games).current)).toBe("L1");
  });

  it("has no streak before the first game", () => {
    const s = streaksOf("A", []);
    expect(s.current).toBeNull();
    expect(streakLabel(s.current)).toBe("");
    expect(s.longestWin).toBe(0);
  });

  it("groups runs of identical results", () => {
    expect(runs(["W", "W", "L", "T", "T", "T"])).toEqual([
      { outcome: "W", length: 2 },
      { outcome: "L", length: 1 },
      { outcome: "T", length: 3 },
    ]);
  });

  it("writes a note only for streaks worth mentioning", () => {
    expect(streakNote("Kickers", null)).toBeNull();
    expect(streakNote("Kickers", { outcome: "W", length: 1 })).toBeNull();
    expect(streakNote("Kickers", { outcome: "W", length: 2 })).toBe(
      "Kickers have won 2 straight.",
    );
    expect(streakNote("Kickers", { outcome: "W", length: 5 })).toContain(
      "on fire",
    );
    expect(streakNote("Kickers", { outcome: "L", length: 3 })).toContain("due");
    expect(streakNote("Kickers", { outcome: "L", length: 4 })).toContain(
      "only way is up",
    );
    expect(streakNote("Kickers", { outcome: "T", length: 2 })).toContain(
      "tied 2",
    );
  });

  describe("properties", () => {
    it("agree with the standings' streak column", () => {
      fc.assert(
        fc.property(gamesArb(), (games) => {
          const table = standings(TEAMS, games.map(toResult), { seed: "s" });
          const mine = teamStreaks(TEAMS, games);
          for (const row of table)
            expect(streakLabel(mine.get(row.teamId)?.current ?? null)).toBe(
              row.streak,
            );
        }),
      );
    });

    it("stay within the games played and the results of each kind", () => {
      fc.assert(
        fc.property(gamesArb(), (games) => {
          for (const s of teamStreaks(TEAMS, games).values()) {
            const outcomes = games
              .filter((g) => g.teamA === s.team || g.teamB === s.team)
              .map((g) => {
                if (g.result.kind === "forfeit")
                  return g.result.forfeitBy === s.team ? "L" : "W";
                const mine =
                  g.teamA === s.team ? g.result.scoreA : g.result.scoreB;
                const theirs =
                  g.teamA === s.team ? g.result.scoreB : g.result.scoreA;
                return mine > theirs ? "W" : mine < theirs ? "L" : "T";
              });
            const wins = outcomes.filter((o) => o === "W").length;
            const losses = outcomes.filter((o) => o === "L").length;
            expect(s.played).toBe(outcomes.length);
            expect(s.longestWin).toBeLessThanOrEqual(wins);
            expect(s.longestLoss).toBeLessThanOrEqual(losses);
            if (s.played === 0) expect(s.current).toBeNull();
            else {
              const current = s.current;
              expect(current).not.toBeNull();
              if (!current) return;
              expect(current.length).toBeGreaterThanOrEqual(1);
              expect(current.length).toBeLessThanOrEqual(s.played);
              if (current.outcome === "W")
                expect(s.longestWin).toBeGreaterThanOrEqual(current.length);
              if (current.outcome === "L")
                expect(s.longestLoss).toBeGreaterThanOrEqual(current.length);
            }
          }
        }),
      );
    });

    it("runs add back up to the results they came from", () => {
      fc.assert(
        fc.property(
          fc.array(fc.constantFrom("W" as const, "L" as const, "T" as const)),
          (outcomes) => {
            const all = runs(outcomes);
            expect(all.flatMap((r) => Array(r.length).fill(r.outcome))).toEqual(
              outcomes,
            );
            // Neighbouring runs always differ, or they would be one run.
            all.slice(1).forEach((r, i) => {
              expect(r.outcome).not.toBe(all[i]?.outcome);
            });
          },
        ),
      );
    });
  });
});
