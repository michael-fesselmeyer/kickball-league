import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { divisionStandings, type ResultGame, standings } from "./standings";

const played = (
  teamA: string,
  scoreA: number,
  teamB: string,
  scoreB: number,
): ResultGame => ({ kind: "played", teamA, teamB, scoreA, scoreB });

const groups = [
  { id: "competitive", teamIds: ["A", "B", "C"] },
  { id: "social", teamIds: ["X", "Y", "Z"] },
];

// A and X each win a crossover; inside the divisions, B and Y lead.
const games = [
  played("B", 5, "A", 1),
  played("B", 3, "C", 2),
  played("Y", 6, "X", 0),
  played("A", 9, "Z", 2),
  played("X", 7, "C", 1),
];

const table = (rows: { teamId: string; wins: number; losses: number }[]) =>
  rows.map((r) => `${r.teamId} ${r.wins}-${r.losses}`);

describe("division standings", () => {
  it("ranks each team only against its own division", () => {
    const [competitive, social] = divisionStandings(groups, games, {
      seed: "s",
    });
    expect(competitive?.id).toBe("competitive");
    expect(social?.id).toBe("social");
    expect(competitive?.rows.map((r) => r.teamId).sort()).toEqual([
      "A",
      "B",
      "C",
    ]);
    expect(social?.rows.map((r) => r.teamId).sort()).toEqual(["X", "Y", "Z"]);
  });

  it("counts crossover results toward each team's record by default", () => {
    const [competitive, social] = divisionStandings(groups, games, {
      seed: "s",
    });
    expect(table(competitive?.rows ?? [])).toEqual(["B 2-0", "A 1-1", "C 0-2"]);
    expect(table(social?.rows ?? [])).toEqual(["Y 1-0", "X 1-1", "Z 0-1"]);
  });

  it("leaves crossover results out when the season says so", () => {
    const [competitive, social] = divisionStandings(groups, games, {
      seed: "s",
      crossoversCount: false,
    });
    // C lost by less, so run difference puts it above A.
    expect(table(competitive?.rows ?? [])).toEqual(["B 2-0", "C 0-1", "A 0-1"]);
    expect(table(social?.rows ?? [])).toEqual(["Y 1-0", "Z 0-0", "X 0-1"]);
  });

  it("breaks head-to-head ties with games inside the division only", () => {
    // A and C are 1-1. C beat A; A's win was a crossover.
    const tied = [
      played("C", 4, "A", 3),
      played("A", 8, "X", 1),
      played("Y", 5, "C", 2),
    ];
    const [competitive] = divisionStandings(groups, tied, {
      seed: "s",
      tiebreakers: ["win_pct", "head_to_head"],
    });
    expect(
      competitive?.rows.map((r) => `${r.teamId}:${r.separatedBy ?? "-"}`),
    ).toEqual(["C:-", "A:head_to_head", "B:win_pct"]);
  });

  it("is the season table when there is one group", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            a: fc.constantFrom("A", "B", "C", "D"),
            b: fc.constantFrom("A", "B", "C", "D"),
            sa: fc.nat({ max: 15 }),
            sb: fc.nat({ max: 15 }),
          }),
          { maxLength: 20 },
        ),
        (raw) => {
          const all = raw
            .filter((g) => g.a !== g.b)
            .map((g) => played(g.a, g.sa, g.b, g.sb));
          const teams = ["A", "B", "C", "D"];
          for (const crossoversCount of [true, false])
            expect(
              divisionStandings([{ id: "all", teamIds: teams }], all, {
                seed: "s",
                crossoversCount,
              })[0]?.rows,
            ).toEqual(standings(teams, all, { seed: "s" }));
        },
      ),
    );
  });

  it("gives every team in a division a row, played or not", () => {
    fc.assert(
      fc.property(fc.boolean(), (crossoversCount) => {
        const result = divisionStandings(groups, games, {
          seed: "s",
          crossoversCount,
        });
        for (const [i, group] of groups.entries())
          expect(result[i]?.rows).toHaveLength(group.teamIds.length);
      }),
    );
  });
});
