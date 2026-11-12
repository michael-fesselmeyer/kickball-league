import { and, asc, eq, ne } from "drizzle-orm";
import {
  type AllTimeRecord,
  allTimeRecordOf,
  allTimeRecords,
  type SeasonResult,
  seasonChampion,
} from "@/domain/history/history";
import type { LeagueId, SeasonId, TeamId } from "@/domain/ids";
import type { StandingsRow } from "@/domain/standings/standings";
import { season } from "../schema/season";
import { teamSeason } from "../schema/team";
import type { Db } from "./schedule";
import { seasonStandings, type StandingsTeam } from "./standings";

/**
 * League history: past seasons with their champions and final standings,
 * and all-time records. Built from each season's standings on demand, so
 * there is nothing stored to drift (docs/data-model.md, section 2.2).
 */

type SeasonInfo = {
  id: SeasonId;
  name: string;
  slug: string;
  status: (typeof season.$inferSelect)["status"];
  startsOn: string;
  endsOn: string;
};

const SEASON_COLUMNS = {
  id: season.id,
  name: season.name,
  slug: season.slug,
  status: season.status,
  startsOn: season.startsOn,
  endsOn: season.endsOn,
};

/**
 * Each season's standings with teams keyed by slug, which stays the same
 * from season to season, unlike a season entry.
 */
async function seasonResults(db: Db, seasons: readonly SeasonInfo[]) {
  const teams = new Map<string, StandingsTeam>();
  const results: (Omit<SeasonResult, "rows"> & { rows: StandingsRow[] })[] = [];
  for (const s of seasons) {
    const { rows, teams: entries } = await seasonStandings(db, s.id);
    const bySlug = rows.flatMap((r) => {
      const t = entries.get(r.teamId);
      if (!t) return [];
      teams.set(t.slug, t);
      return [{ ...r, teamId: t.slug }];
    });
    results.push({
      seasonId: s.id,
      completed: s.status === "completed",
      rows: bySlug,
      // The playoff bracket's winner arrives with the playoff tables.
      bracketChampion: null,
    });
  }
  return { results, teams };
}

export type PastSeason = SeasonInfo & {
  champion: StandingsTeam | null;
  standings: (StandingsRow & { team: StandingsTeam | null })[];
};

export type AllTimeRow = AllTimeRecord & { info: StandingsTeam | null };

/**
 * The league's completed seasons, newest first, each with its champion and
 * final standings; and every team's all-time record over every public
 * season, the one being played included.
 */
export async function leagueHistory(
  db: Db,
  leagueId: LeagueId,
): Promise<{ pastSeasons: PastSeason[]; allTime: AllTimeRow[] }> {
  const seasons = await db
    .select(SEASON_COLUMNS)
    .from(season)
    .where(and(eq(season.leagueId, leagueId), ne(season.status, "draft")))
    .orderBy(asc(season.startsOn));
  const { results, teams } = await seasonResults(db, seasons);
  const pastSeasons = seasons.flatMap((s, i): PastSeason[] => {
    const result = results[i];
    if (!result || !result.completed) return [];
    const champion = seasonChampion(result);
    return [
      {
        ...s,
        champion: champion ? (teams.get(champion) ?? null) : null,
        standings: result.rows.map((r) => ({
          ...r,
          team: teams.get(r.teamId) ?? null,
        })),
      },
    ];
  });
  return {
    pastSeasons: pastSeasons.reverse(),
    allTime: allTimeRecords(results).map((r) => ({
      ...r,
      info: teams.get(r.team) ?? null,
    })),
  };
}

/**
 * One team's all-time record over the public seasons it entered, with the
 * seasons it won, oldest first. Withdrawn entries do not count.
 */
export async function teamHistory(
  db: Db,
  teamId: TeamId,
  slug: string,
): Promise<{
  record: AllTimeRecord;
  titles: { name: string; slug: string }[];
}> {
  const seasons = await db
    .select(SEASON_COLUMNS)
    .from(teamSeason)
    .innerJoin(season, eq(teamSeason.seasonId, season.id))
    .where(
      and(
        eq(teamSeason.teamId, teamId),
        ne(teamSeason.status, "withdrawn"),
        ne(season.status, "draft"),
      ),
    )
    .orderBy(asc(season.startsOn));
  const { results } = await seasonResults(db, seasons);
  const record = allTimeRecordOf(slug, results);
  const won = new Set(record.titleSeasonIds);
  return {
    record,
    titles: seasons
      .filter((s) => won.has(s.id))
      .map((s) => ({ name: s.name, slug: s.slug })),
  };
}
