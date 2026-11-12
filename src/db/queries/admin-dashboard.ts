import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { GameId, SeasonId, TeamSeasonId } from "@/domain/ids";
import { localDate } from "@/domain/scheduler/slots";
import { game, slot } from "../schema/game";
import { league } from "../schema/league";
import { season } from "../schema/season";
import { refereeBoard } from "./referees";
import { registrationsBoard } from "./registrations-admin";
import { teamRsvps, type TeamRsvps } from "./rsvps";
import { seasonBySlug } from "./schedule-screen";
import type { Db } from "./schedule";
import { scoresNeedingAttention } from "./scores";

/**
 * The admin home (product-spec.md, "League admin"; information-architecture.md,
 * "Admin: next game day"): is the next game day ready, which past games still
 * need a score, and where each team stands on registration. Built on the
 * referee, RSVP, score and registration queries so every screen agrees.
 */

export type DashboardSeason = NonNullable<
  Awaited<ReturnType<typeof seasonBySlug>>
>;

/** Games still to be played, as opposed to finished, called off or postponed. */
const TO_PLAY = new Set(["scheduled", "in_progress"]);

/**
 * The season the dashboard opens on: the one asked for by slug, else the one
 * with the next game to play, else the latest season that is past draft,
 * else the latest season. Null when there are no seasons.
 */
export async function dashboardSeason(
  db: Db,
  now: Date,
  slug?: string,
): Promise<DashboardSeason | null> {
  if (slug) return seasonBySlug(db, slug);
  const [upcoming] = await db
    .select({ slug: season.slug })
    .from(game)
    .innerJoin(slot, eq(game.slotId, slot.id))
    .innerJoin(season, eq(game.seasonId, season.id))
    .innerJoin(league, eq(season.leagueId, league.id))
    .where(
      and(
        inArray(game.status, ["scheduled", "in_progress"]),
        eq(slot.status, "open"),
        // Today in the league's own time zone counts as upcoming.
        sql`(${slot.startsAt} at time zone ${league.timezone})::date >= (${now.toISOString()}::timestamptz at time zone ${league.timezone})::date`,
      ),
    )
    .orderBy(asc(slot.startsAt))
    .limit(1);
  const [latest] = upcoming
    ? [upcoming]
    : await db
        .select({ slug: season.slug })
        .from(season)
        .orderBy(
          // Past-draft seasons first, then the most recent start.
          sql`(${season.status} = 'draft')`,
          desc(season.startsOn),
        )
        .limit(1);
  return latest ? seasonBySlug(db, latest.slug) : null;
}

export type GameDayTeam = {
  teamSeasonId: TeamSeasonId;
  name: string;
  rsvps: TeamRsvps;
};

export type GameDayGame = {
  id: GameId;
  status: string;
  /** The slot was called off by a rain-out and the game awaits a makeup. */
  rainedOut: boolean;
  startsAt: Date;
  fieldName: string;
  referee: { name: string } | null;
  teams: [GameDayTeam, GameDayTeam];
};

export type GameDay = {
  /** The local date, YYYY-MM-DD. */
  date: string;
  games: GameDayGame[];
  fields: number;
  withoutReferee: number;
  /** Team entries whose RSVPs fall short of a full lineup. */
  fieldingWarnings: number;
};

/**
 * The next local date, from today, with a game still to play, and every game
 * placed on that date with its referee and each team's RSVP fielding check.
 */
export async function nextGameDay(
  db: Db,
  current: Pick<DashboardSeason, "id" | "timeZone">,
  now: Date,
): Promise<GameDay | null> {
  const today = localDate(now, current.timeZone);
  const board = (await refereeBoard(db, current.id)).map((g) => ({
    ...g,
    date: localDate(g.startsAt, current.timeZone),
  }));
  const dates = board
    .filter(
      (g) =>
        TO_PLAY.has(g.status) && g.slotStatus === "open" && g.date >= today,
    )
    .map((g) => g.date)
    .sort();
  const date = dates[0];
  if (date === undefined) return null;
  const onDay = board.filter((g) => g.date === date);

  // One RSVP lookup per team, covering all of its games that day.
  const gamesOf = new Map<TeamSeasonId, GameId[]>();
  for (const g of onDay)
    for (const t of [g.teamAId, g.teamBId])
      gamesOf.set(t, [...(gamesOf.get(t) ?? []), g.id]);
  const rsvpsOf = new Map<TeamSeasonId, Map<GameId, TeamRsvps>>();
  for (const [teamSeasonId, gameIds] of gamesOf)
    rsvpsOf.set(teamSeasonId, await teamRsvps(db, teamSeasonId, gameIds));
  const rsvps = (teamSeasonId: TeamSeasonId, gameId: GameId): TeamRsvps => {
    const found = rsvpsOf.get(teamSeasonId)?.get(gameId);
    if (!found) throw new Error(`No RSVPs loaded for game ${gameId}`);
    return found;
  };

  const games: GameDayGame[] = onDay.map((g) => ({
    id: g.id,
    status: g.status,
    rainedOut: g.slotStatus === "cancelled",
    startsAt: g.startsAt,
    fieldName: g.fieldName,
    referee: g.referee ? { name: g.referee.name } : null,
    teams: [
      {
        teamSeasonId: g.teamAId,
        name: g.teamAName,
        rsvps: rsvps(g.teamAId, g.id),
      },
      {
        teamSeasonId: g.teamBId,
        name: g.teamBName,
        rsvps: rsvps(g.teamBId, g.id),
      },
    ],
  }));
  const live = games.filter((g) => TO_PLAY.has(g.status) && !g.rainedOut);
  return {
    date,
    games,
    fields: new Set(live.map((g) => g.fieldName)).size,
    withoutReferee: live.filter((g) => g.referee === null).length,
    fieldingWarnings: live
      .flatMap((g) => g.teams)
      .filter((t) => t.rsvps.fielding.level !== "full").length,
  };
}

/**
 * Games from earlier game days that still have no final score: nobody
 * reported, a report awaits confirmation, or a captain disputed it. Today's
 * games are left out; they are still being played.
 */
export async function missingScores(
  db: Db,
  current: Pick<DashboardSeason, "id" | "timeZone">,
  now: Date,
) {
  const today = localDate(now, current.timeZone);
  return (await scoresNeedingAttention(db, current.id, now)).filter(
    (g) =>
      localDate(g.startsAt, current.timeZone) < today &&
      // Due to finalize on the next run of the scores job.
      g.state.state !== "final",
  );
}

export type TeamSummary = {
  teamSeasonId: TeamSeasonId;
  name: string;
  status: string;
  players: number;
  paid: number;
  signed: number;
};

export type GroupSummary = Pick<TeamSummary, "players" | "paid" | "signed">;

/** Registrations, payments and waivers counted by team, plus free agents. */
export async function registrationSummary(
  db: Db,
  seasonId: SeasonId,
): Promise<{
  teams: TeamSummary[];
  freeAgents: GroupSummary;
  totals: GroupSummary;
}> {
  const board = await registrationsBoard(db, seasonId);
  const count = (people: { paid: boolean; signed: boolean }[]) => ({
    players: people.length,
    paid: people.filter((p) => p.paid).length,
    signed: people.filter((p) => p.signed).length,
  });
  const teams = board.teams.map((t) => ({
    teamSeasonId: t.teamSeasonId,
    name: t.name,
    status: t.status,
    ...count(t.members),
  }));
  const freeAgents = count(board.freeAgents);
  return {
    teams,
    freeAgents,
    totals: count([
      ...board.teams.flatMap((t) => t.members),
      ...board.freeAgents,
    ]),
  };
}

/** Every season but the one shown, for switching. */
export async function otherSeasons(db: Db, shownId: SeasonId) {
  return db
    .select({ name: season.name, slug: season.slug, status: season.status })
    .from(season)
    .where(ne(season.id, shownId))
    .orderBy(desc(season.startsOn));
}
