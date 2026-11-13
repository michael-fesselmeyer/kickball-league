import { describe, expect, it } from "vitest";
import {
  divisionStandings,
  type ResultGame,
} from "@/domain/standings/standings";
import { generateSeed } from "./generate";
import { generatePastSeasons } from "./past-seasons";
import {
  DIVIDED_SEASON,
  generateSeedDivisions,
  SEED_DIVISIONS,
} from "./divisions";

const data = generateSeed();
const seeded = generateSeedDivisions(data);
const summer = generatePastSeasons(data).seasons.find(
  (p) => p.season.slug === DIVIDED_SEASON,
);

describe("the seeded divisions", () => {
  it("splits every summer team into one of two divisions with a rule set", () => {
    expect(seeded.divisions.map((d) => d.name)).toEqual([
      "Competitive",
      "Social",
    ]);
    expect(seeded.assignments).toHaveLength(summer?.entries.length ?? 0);
    for (const d of seeded.divisions)
      expect(
        seeded.assignments.filter((a) => a.divisionId === d.id),
      ).toHaveLength(4);
    expect(seeded.ruleSets.map((r) => r.innings)).toEqual([7, 5]);
  });

  it("counts four crossover games a team, as the round robin played", () => {
    const division = new Map(
      seeded.assignments.map((a) => [a.teamSeasonId as string, a.divisionId]),
    );
    const games = summer?.games ?? [];
    for (const a of seeded.assignments) {
      const own = games.filter(
        (g) => g.teamAId === a.teamSeasonId || g.teamBId === a.teamSeasonId,
      );
      const crossing = own.filter(
        (g) => division.get(g.teamAId) !== division.get(g.teamBId),
      );
      expect(crossing).toHaveLength(seeded.crossoverGames);
      expect(own.length - crossing.length).toBe(3);
    }
  });

  it("gives each division a full table", () => {
    const results: ResultGame[] = (summer?.games ?? []).map((g) =>
      g.status === "forfeit"
        ? {
            kind: "forfeit",
            teamA: g.teamAId,
            teamB: g.teamBId,
            forfeitBy: g.forfeitBy as string,
          }
        : {
            kind: "played",
            teamA: g.teamAId,
            teamB: g.teamBId,
            scoreA: g.scoreA as number,
            scoreB: g.scoreB as number,
          },
    );
    const tables = divisionStandings(
      seeded.divisions.map((d) => ({
        id: d.id,
        teamIds: seeded.assignments
          .filter((a) => a.divisionId === d.id)
          .map((a) => a.teamSeasonId),
      })),
      results,
      { seed: seeded.seasonId },
    );
    for (const t of tables) {
      expect(t.rows).toHaveLength(4);
      for (const row of t.rows) expect(row.played).toBe(7);
    }
    expect(SEED_DIVISIONS).toHaveLength(2);
  });
});
