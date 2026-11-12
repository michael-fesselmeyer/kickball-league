import { and, eq, inArray, ne } from "drizzle-orm";
import type { SeasonId } from "@/domain/ids";
import {
  type ResultGame,
  type StandingsRow,
  standings,
} from "@/domain/standings/standings";
import { game } from "../schema/game";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import type { Db } from "./schedule";

export type StandingsTeam = {
  name: string;
  slug: string;
  colorHex: string | null;
};

/**
 * A season's standings from its finished regular-season games: final scores
 * and forfeits. Computed on demand; there is no standings table to drift
 * (docs/data-model.md, section 2.2).
 */
export async function seasonStandings(
  db: Db,
  seasonId: SeasonId,
): Promise<{ rows: StandingsRow[]; teams: Map<string, StandingsTeam> }> {
  const [settings] = await db
    .select({ tiebreakers: season.tiebreakers })
    .from(season)
    .where(eq(season.id, seasonId));
  const entries = await db
    .select({
      id: teamSeason.id,
      name: team.name,
      slug: team.slug,
      colorHex: team.colorHex,
    })
    .from(teamSeason)
    .innerJoin(team, eq(teamSeason.teamId, team.id))
    .where(
      and(
        eq(teamSeason.seasonId, seasonId),
        ne(teamSeason.status, "withdrawn"),
      ),
    );
  const finished = await db
    .select({
      teamA: game.teamAId,
      teamB: game.teamBId,
      scoreA: game.scoreA,
      scoreB: game.scoreB,
      status: game.status,
      forfeitBy: game.forfeitBy,
    })
    .from(game)
    .where(
      and(
        eq(game.seasonId, seasonId),
        eq(game.kind, "regular"),
        inArray(game.status, ["final", "forfeit"]),
      ),
    )
    .orderBy(game.finalizedAt);
  const games: ResultGame[] = finished.flatMap((g): ResultGame[] => {
    if (g.status === "forfeit" && g.forfeitBy)
      return [
        {
          kind: "forfeit",
          teamA: g.teamA,
          teamB: g.teamB,
          forfeitBy: g.forfeitBy,
        },
      ];
    if (g.scoreA === null || g.scoreB === null) return [];
    return [
      {
        kind: "played",
        teamA: g.teamA,
        teamB: g.teamB,
        scoreA: g.scoreA,
        scoreB: g.scoreB,
      },
    ];
  });
  const rows = standings(
    entries.map((e) => e.id),
    games,
    {
      seed: seasonId,
      ...(settings ? { tiebreakers: settings.tiebreakers } : {}),
    },
  );
  return {
    rows,
    teams: new Map(
      entries.map((e) => [
        e.id,
        { name: e.name, slug: e.slug, colorHex: e.colorHex },
      ]),
    ),
  };
}
