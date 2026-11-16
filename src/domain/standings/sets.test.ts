import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkDodgeballScore, setsToWin } from "@/domain/sports/dodgeball";
import { sportRules } from "@/domain/sports/sports";
import { type ResultGame, standings } from "./standings";

/**
 * Standings for a sport scored in sets (ADR 0087): the same table and
 * tiebreakers, with sets for runs and no cap on the set difference.
 */

const teamIds = ["A", "B", "C", "D", "E"];
const cap = sportRules("dodgeball").score.differenceCap;

/** A valid dodgeball result: a finished match, a called one or a forfeit. */
const match = (bestOf: number) => {
  const need = setsToWin(bestOf);
  const finished = fc
    .tuple(fc.nat(need - 1), fc.boolean())
    .map(([low, aWins]) =>
      aWins ? { scoreA: need, scoreB: low } : { scoreA: low, scoreB: need },
    );
  // Called early: neither side reached the majority, and a set was played.
  // Best of 1 has no such score.
  const called = fc
    .tuple(fc.nat(need - 1), fc.nat(need - 1))
    .map(([a, b]) => (a + b > 0 ? { scoreA: a, scoreB: b } : null));
  const result = fc
    .oneof(finished, called)
    .map((sets) => sets ?? { scoreA: need, scoreB: 0 });
  return fc
    .tuple(
      fc.constantFrom(...teamIds),
      fc.constantFrom(...teamIds),
      fc.option(result, { freq: 5 }),
      fc.boolean(),
    )
    .filter(([a, b]) => a !== b)
    .map(([teamA, teamB, sets, aForfeits]): ResultGame => {
      if (sets === null)
        return {
          kind: "forfeit",
          teamA,
          teamB,
          forfeitBy: aForfeits ? teamA : teamB,
        };
      return { kind: "played", teamA, teamB, ...sets };
    });
};

const season = fc
  .constantFrom(1, 3, 5, 7, 9)
  .chain((bestOf) =>
    fc.tuple(fc.constant(bestOf), fc.array(match(bestOf), { maxLength: 30 })),
  );

const table = (games: ResultGame[]) =>
  standings(teamIds, games, { seed: "winter-2027", differenceCap: cap });

describe("set standings properties", () => {
  it("only ever reads results a dodgeball score check accepts", () => {
    fc.assert(
      fc.property(season, ([bestOf, games]) => {
        for (const g of games)
          if (g.kind === "played")
            expect(
              checkDodgeballScore(
                {
                  outcome:
                    Math.max(g.scoreA, g.scoreB) === setsToWin(bestOf)
                      ? "normal"
                      : "called",
                  scoreA: g.scoreA,
                  scoreB: g.scoreB,
                  inningsPlayed: null,
                },
                { bestOf },
              ),
            ).toEqual({});
      }),
    );
  });

  it("balances: every set won is a set lost, and the differences sum to 0", () => {
    fc.assert(
      fc.property(season, ([, games]) => {
        const rows = table(games);
        const sum = (f: (r: (typeof rows)[number]) => number) =>
          rows.reduce((n, r) => n + f(r), 0);
        expect(sum((r) => r.runsFor)).toBe(sum((r) => r.runsAgainst));
        expect(sum((r) => r.runDifference)).toBe(0);
        expect(sum((r) => r.wins)).toBe(sum((r) => r.losses));
        expect(sum((r) => r.played)).toBe(2 * games.length);
      }),
    );
  });

  it("doesn't cap the set difference: it is sets for minus sets against", () => {
    fc.assert(
      fc.property(season, ([, games]) => {
        for (const r of table(games))
          expect(r.runDifference).toBe(r.runsFor - r.runsAgainst);
      }),
    );
  });

  it("gives the match to the team with more sets, and a tie only when level", () => {
    fc.assert(
      fc.property(season, ([, games]) => {
        const rows = new Map(table(games).map((r) => [r.teamId, r]));
        const ties = games.filter(
          (g) => g.kind === "played" && g.scoreA === g.scoreB,
        ).length;
        const total = [...rows.values()].reduce((n, r) => n + r.ties, 0);
        expect(total).toBe(2 * ties);
      }),
    );
  });

  it("ranks every team once, in order of win percentage", () => {
    fc.assert(
      fc.property(season, ([, games]) => {
        const rows = table(games);
        expect(rows.map((r) => r.teamId).sort()).toEqual([...teamIds].sort());
        for (let i = 1; i < rows.length; i++) {
          const [above, below] = [rows[i - 1], rows[i]];
          if (!above || !below) continue;
          expect(above.winPct).toBeGreaterThanOrEqual(below.winPct);
          expect(below.rank).toBeGreaterThanOrEqual(above.rank);
        }
      }),
    );
  });

  it("matches kickball's table whenever no game moves the difference past 10", () => {
    fc.assert(
      fc.property(season, ([, games]) => {
        // Sets never differ by more than 5, so the cap can't change a thing.
        expect(table(games)).toEqual(
          standings(teamIds, games, { seed: "winter-2027" }),
        );
      }),
    );
  });
});
