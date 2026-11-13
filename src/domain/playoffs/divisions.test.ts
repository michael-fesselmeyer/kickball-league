import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { placeBracket } from "@/domain/scheduler/bracket";
import { divisionHalvesSeeds, matchesFrom, nextMatch } from "./playoffs";

const teams = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

describe("seeding two divisions into one bracket", () => {
  it("puts each division in its own half, in standard order", () => {
    const seeds = divisionHalvesSeeds(teams("C", 4), teams("S", 4));
    // Bracket seeds 1, 4, 5 and 8 make up the top half of an eight-team
    // bracket; 2, 3, 6 and 7 the bottom.
    expect(seeds).toEqual(["C1", "S1", "S2", "C2", "C3", "S3", "S4", "C4"]);
    const first = matchesFrom(placeBracket(seeds ?? [], []))
      .filter((m) => m.round === 1)
      .map((m) => `${m.teamA}-${m.teamB}`);
    expect(first).toEqual(["C1-C4", "C2-C3", "S1-S4", "S2-S3"]);
  });

  it("gives each division champion a bye when the field is uneven", () => {
    const seeds = divisionHalvesSeeds(teams("C", 3), teams("S", 3)) ?? [];
    expect(seeds).toHaveLength(6);
    const first = matchesFrom(placeBracket(seeds, []))
      .filter((m) => m.round === 1)
      .map((m) => `${m.teamA}-${m.teamB}`);
    expect(first).toEqual(["C2-C3", "S2-S3"]);
  });

  it("plays the final straight away with one team each", () => {
    expect(divisionHalvesSeeds(["C1"], ["S1"])).toEqual(["C1", "S1"]);
  });

  it("needs the same number of teams from each division", () => {
    expect(divisionHalvesSeeds(teams("C", 3), teams("S", 2))).toBeNull();
    expect(divisionHalvesSeeds([], [])).toBeNull();
  });

  it("never lets the divisions meet before the final", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 16 }), (n) => {
        const seeds = divisionHalvesSeeds(teams("C", n), teams("S", n));
        // Seeds 1 to 2n, every one a team: no holes for placeBracket.
        expect(seeds).toHaveLength(2 * n);
        expect(new Set(seeds).size).toBe(2 * n);
        const matches = matchesFrom(placeBracket(seeds ?? [], []));
        // Follow each team's path: every match but the final draws both
        // sides from one division.
        const division = (code: string): Set<string> => {
          const m = matches.find((x) => x.code === code);
          const side = (
            team: string | null,
            from: (typeof m & object)["sourceA"],
          ) =>
            team
              ? new Set([team[0] as string])
              : "winnerOf" in from
                ? division(from.winnerOf)
                : new Set<string>();
          return m
            ? new Set([
                ...side(m.teamA, m.sourceA),
                ...side(m.teamB, m.sourceB),
              ])
            : new Set();
        };
        const final = matches.find((m) => nextMatch(matches, m.code) === null);
        for (const m of matches)
          if (m !== final) expect(division(m.code).size).toBe(1);
        if (final) expect(division(final.code)).toEqual(new Set(["C", "S"]));
      }),
    );
  });
});
