import { and, eq, inArray, ne } from "drizzle-orm";
import type { SeasonId } from "@/domain/ids";
import { groupByDivision } from "@/domain/season/divisions";
import {
  divisionStandings,
  type ResultGame,
  type StandingsRow,
  standings,
} from "@/domain/standings/standings";
import { game } from "../schema/game";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import { type DivisionRow, seasonDivisions } from "./divisions";
import type { Db } from "./schedule";

export type StandingsTeam = {
  name: string;
  slug: string;
  colorHex: string | null;
};

/** A season's settings, team entries and finished regular-season games. */
async function standingsData(db: Db, seasonId: SeasonId) {
  const [[settings], entries, finished] = await Promise.all([
    db
      .select({
        tiebreakers: season.tiebreakers,
        crossoversCount: season.crossoversCount,
      })
      .from(season)
      .where(eq(season.id, seasonId)),
    db
      .select({
        id: teamSeason.id,
        name: team.name,
        slug: team.slug,
        colorHex: team.colorHex,
        divisionId: teamSeason.divisionId,
      })
      .from(teamSeason)
      .innerJoin(team, eq(teamSeason.teamId, team.id))
      .where(
        and(
          eq(teamSeason.seasonId, seasonId),
          ne(teamSeason.status, "withdrawn"),
        ),
      ),
    db
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
      .orderBy(game.finalizedAt),
  ]);
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
  const options = {
    seed: seasonId,
    ...(settings ? { tiebreakers: settings.tiebreakers } : {}),
  };
  const teams = new Map<string, StandingsTeam>(
    entries.map((e) => [
      e.id,
      { name: e.name, slug: e.slug, colorHex: e.colorHex },
    ]),
  );
  return {
    entries,
    games,
    options,
    crossoversCount: settings?.crossoversCount ?? true,
    teams,
  };
}

/**
 * A season's standings from its finished regular-season games: final scores
 * and forfeits, every team in one table. Computed on demand; there is no
 * standings table to drift (docs/data-model.md, section 2.2).
 */
export async function seasonStandings(
  db: Db,
  seasonId: SeasonId,
): Promise<{ rows: StandingsRow[]; teams: Map<string, StandingsTeam> }> {
  const { entries, games, options, teams } = await standingsData(db, seasonId);
  const rows = standings(
    entries.map((e) => e.id),
    games,
    options,
  );
  return { rows, teams };
}

/** One division's table; `division` is null for teams without one. */
export type DivisionTable = {
  division: DivisionRow | null;
  rows: StandingsRow[];
};

/**
 * Standings per division (ADR 0035): each team ranked within its own
 * division, with crossover results counted as the season says. A season
 * without divisions gets one table with every team, the same as
 * `seasonStandings`; teams not yet in a division get a table of their own.
 */
export async function seasonDivisionStandings(
  db: Db,
  seasonId: SeasonId,
): Promise<{
  tables: DivisionTable[];
  teams: Map<string, StandingsTeam>;
  crossoversCount: boolean;
}> {
  const [data, divisions] = await Promise.all([
    standingsData(db, seasonId),
    seasonDivisions(db, seasonId),
  ]);
  const groups = groupByDivision(divisions, data.entries);
  const byId = new Map(divisions.map((d) => [d.id as string, d]));
  const tables = divisionStandings(
    groups.map((g, i) => ({
      id: g.divisionId ?? `none-${i}`,
      teamIds: g.teams.map((t) => t.id),
    })),
    data.games,
    { ...data.options, crossoversCount: data.crossoversCount },
  ).map((table) => ({
    division: byId.get(table.id) ?? null,
    rows: table.rows,
  }));
  return { tables, teams: data.teams, crossoversCount: data.crossoversCount };
}
