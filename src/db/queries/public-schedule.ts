import {
  aliasedTable,
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { GameId, SeasonId, TeamId, TeamSeasonId } from "@/domain/ids";
import type { PublicGame } from "@/domain/schedule/public-game";
import { field, game, slot, venue } from "../schema/game";
import { league } from "../schema/league";
import { profile } from "../schema/profile";
import { gamePlacement, scheduleVersion } from "../schema/schedule";
import { season } from "../schema/season";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import type { Db } from "./schedule";

/**
 * What the public schedule, team and game pages and the calendar feeds read.
 * Games come from the placements of each season's published schedule
 * version, never a draft, and draft seasons are not public at all.
 */

const entryA = aliasedTable(teamSeason, "entry_a");
const entryB = aliasedTable(teamSeason, "entry_b");
const teamA = aliasedTable(team, "team_a");
const teamB = aliasedTable(team, "team_b");

async function publishedGames(db: Db, where: SQL | undefined) {
  const rows = await db
    .select({
      id: game.id,
      seasonId: game.seasonId,
      seasonName: season.name,
      seasonSlug: season.slug,
      versionNo: scheduleVersion.versionNo,
      roundNo: game.roundNo,
      kind: game.kind,
      status: game.status,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      slotStatus: slot.status,
      field: field.name,
      venueName: venue.name,
      venueSlug: venue.slug,
      venueAddress: venue.address,
      venueLat: venue.lat,
      venueLng: venue.lng,
      teamAId: entryA.id,
      teamAName: teamA.name,
      teamASlug: teamA.slug,
      teamAColor: teamA.colorHex,
      teamBId: entryB.id,
      teamBName: teamB.name,
      teamBSlug: teamB.slug,
      teamBColor: teamB.colorHex,
      scoreA: game.scoreA,
      scoreB: game.scoreB,
      forfeitBy: game.forfeitBy,
    })
    .from(gamePlacement)
    .innerJoin(
      scheduleVersion,
      and(
        eq(gamePlacement.scheduleVersionId, scheduleVersion.id),
        eq(scheduleVersion.status, "published"),
      ),
    )
    .innerJoin(game, eq(gamePlacement.gameId, game.id))
    .innerJoin(season, eq(game.seasonId, season.id))
    .innerJoin(entryA, eq(game.teamAId, entryA.id))
    .innerJoin(teamA, eq(entryA.teamId, teamA.id))
    .innerJoin(entryB, eq(game.teamBId, entryB.id))
    .innerJoin(teamB, eq(entryB.teamId, teamB.id))
    .leftJoin(slot, eq(gamePlacement.slotId, slot.id))
    .leftJoin(field, eq(slot.fieldId, field.id))
    .leftJoin(venue, eq(field.venueId, venue.id))
    .where(and(ne(season.status, "draft"), where))
    .orderBy(
      sql`${slot.startsAt} asc nulls last`,
      asc(field.sortOrder),
      asc(field.name),
      asc(game.roundNo),
    );
  return rows.map((r): PublicGame => ({
    id: r.id,
    seasonId: r.seasonId,
    seasonName: r.seasonName,
    seasonSlug: r.seasonSlug,
    versionNo: r.versionNo,
    roundNo: r.roundNo,
    kind: r.kind,
    status: r.status,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    slotCancelled: r.slotStatus === "cancelled",
    field: r.field,
    venue:
      r.venueName && r.venueSlug
        ? {
            name: r.venueName,
            slug: r.venueSlug,
            address: r.venueAddress,
            lat: r.venueLat === null ? null : Number(r.venueLat),
            lng: r.venueLng === null ? null : Number(r.venueLng),
          }
        : null,
    teamA: {
      id: r.teamAId,
      name: r.teamAName,
      slug: r.teamASlug,
      colorHex: r.teamAColor,
    },
    teamB: {
      id: r.teamBId,
      name: r.teamBName,
      slug: r.teamBSlug,
      colorHex: r.teamBColor,
    },
    scoreA: r.scoreA,
    scoreB: r.scoreB,
    forfeitBy: r.forfeitBy,
  }));
}

/** A season's published schedule, in kickoff order; unplaced games last. */
export function publishedSchedule(
  db: Db,
  seasonId: SeasonId,
): Promise<PublicGame[]> {
  return publishedGames(db, eq(game.seasonId, seasonId));
}

/** Every published game a team plays, across its public seasons. */
export function publishedGamesForTeam(
  db: Db,
  teamId: TeamId,
): Promise<PublicGame[]> {
  return publishedGames(db, or(eq(teamA.id, teamId), eq(teamB.id, teamId)));
}

/**
 * Published games one person is part of: those of the team entries they are
 * rostered on and those they referee. Their home screen picks the next one
 * from these to keep on the device for offline use.
 */
export function publishedGamesFor(
  db: Db,
  {
    teamSeasonIds,
    gameIds,
  }: {
    teamSeasonIds: readonly TeamSeasonId[];
    gameIds: readonly GameId[];
  },
): Promise<PublicGame[]> {
  if (teamSeasonIds.length === 0 && gameIds.length === 0)
    return Promise.resolve([]);
  const conditions: SQL[] = [];
  if (teamSeasonIds.length > 0) {
    conditions.push(inArray(entryA.id, [...teamSeasonIds]));
    conditions.push(inArray(entryB.id, [...teamSeasonIds]));
  }
  if (gameIds.length > 0) conditions.push(inArray(game.id, [...gameIds]));
  return publishedGames(db, or(...conditions));
}

/** Every published game in every public season, for the league records. */
export function allPublishedGames(db: Db): Promise<PublicGame[]> {
  return publishedGames(db, undefined);
}

/** Every published game between two teams, by team slug, across seasons. */
export function publishedGamesBetween(
  db: Db,
  slugX: string,
  slugY: string,
): Promise<PublicGame[]> {
  return publishedGames(
    db,
    or(
      and(eq(teamA.slug, slugX), eq(teamB.slug, slugY)),
      and(eq(teamA.slug, slugY), eq(teamB.slug, slugX)),
    ),
  );
}

/** One game, only if a published schedule includes it, with the league's zone. */
export async function publishedGame(db: Db, gameId: GameId) {
  const [found] = await publishedGames(db, eq(game.id, gameId));
  if (!found) return null;
  const [zone] = await db
    .select({ timeZone: league.timezone })
    .from(season)
    .innerJoin(league, eq(season.leagueId, league.id))
    .where(eq(season.id, found.seasonId as SeasonId));
  return { game: found, timeZone: zone?.timeZone ?? "America/New_York" };
}

/**
 * A team by its slug, with its entries in public seasons, newest first, and
 * the league's time zone. Withdrawn entries and deleted teams are hidden.
 */
export async function teamBySlug(db: Db, slug: string) {
  const [found] = await db
    .select({
      id: team.id,
      name: team.name,
      slug: team.slug,
      colorHex: team.colorHex,
      timeZone: league.timezone,
    })
    .from(team)
    .innerJoin(league, eq(team.leagueId, league.id))
    .where(and(eq(team.slug, slug), isNull(team.deletedAt)))
    .orderBy(asc(league.createdAt))
    .limit(1);
  if (!found) return null;
  const entries = await db
    .select({
      id: teamSeason.id,
      seasonId: season.id,
      seasonName: season.name,
      seasonSlug: season.slug,
      seasonStatus: season.status,
      vibe: teamSeason.vibe,
    })
    .from(teamSeason)
    .innerJoin(season, eq(teamSeason.seasonId, season.id))
    .where(
      and(
        eq(teamSeason.teamId, found.id),
        ne(season.status, "draft"),
        ne(teamSeason.status, "withdrawn"),
      ),
    )
    .orderBy(desc(season.startsOn));
  return { ...found, entries };
}

/**
 * Who is on a team, as a visitor may see it: first name and last initial
 * (product-spec.md, permissions). Only the initial leaves the database.
 */
export async function publicRoster(db: Db, teamSeasonId: TeamSeasonId) {
  const rows = await db
    .select({
      firstName: profile.firstName,
      lastInitial: sql<string | null>`left(${profile.lastName}, 1)`,
      role: rosterMembership.role,
    })
    .from(rosterMembership)
    .innerJoin(
      registration,
      eq(rosterMembership.registrationId, registration.id),
    )
    .innerJoin(profile, eq(registration.userId, profile.userId))
    .where(
      and(
        eq(rosterMembership.teamSeasonId, teamSeasonId),
        eq(rosterMembership.status, "active"),
      ),
    )
    .orderBy(
      sql`case ${rosterMembership.role} when 'captain' then 0 when 'co_captain' then 1 else 2 end`,
      asc(profile.firstName),
      asc(profile.lastName),
    );
  return rows.flatMap((r) =>
    r.firstName
      ? [
          {
            name: r.lastInitial
              ? `${r.firstName} ${r.lastInitial.toUpperCase()}.`
              : r.firstName,
            role: r.role,
          },
        ]
      : [],
  );
}
