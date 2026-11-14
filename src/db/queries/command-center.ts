import {
  aliasedTable,
  and,
  asc,
  eq,
  inArray,
  isNull,
  ne,
  sql,
} from "drizzle-orm";
import type { CommandRow } from "@/domain/gameday/command-center";
import type { GameId, LeagueId, UserId } from "@/domain/ids";
import type { HalfInning } from "@/domain/scores/live";
import { user } from "../schema/auth";
import {
  field,
  game,
  gamePeriod,
  refereeAssignment,
  scoreReport,
  slot,
  venue,
} from "../schema/game";
import { league } from "../schema/league";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import { recordAudit } from "./audit";
import type { Db } from "./schedule";

/**
 * The game-day command center (issue #257): the day an admin opens it on,
 * every game that day in one read, and the ref's "I'm at the field".
 * Callers check `season.manage` (the screen) or `referee.check_in`.
 */

const teamA = aliasedTable(team, "team_a");
const teamB = aliasedTable(team, "team_b");
const entryA = aliasedTable(teamSeason, "entry_a");
const entryB = aliasedTable(teamSeason, "entry_b");

/** A slot's local date in the league's time zone. */
const localDay = sql`(${slot.startsAt} at time zone ${league.timezone})::date`;

/**
 * The day the screen shows: today, in the league's time zone, when a game
 * is placed on it; otherwise the next day that has one. Null when no game
 * is placed from today on. Games of draft seasons are left out.
 */
export async function commandDate(
  db: Db,
  leagueId: LeagueId,
  now: Date,
): Promise<string | null> {
  const [found] = await db
    .select({
      day: sql<string>`min(to_char(${localDay}, 'YYYY-MM-DD'))`,
    })
    .from(game)
    .innerJoin(slot, eq(game.slotId, slot.id))
    .innerJoin(season, eq(game.seasonId, season.id))
    .innerJoin(league, eq(season.leagueId, league.id))
    .where(
      and(
        eq(league.id, leagueId),
        ne(season.status, "draft"),
        sql`${localDay} >= (${now.toISOString()}::timestamptz at time zone ${league.timezone})::date`,
      ),
    );
  return found?.day ?? null;
}

export type CommandDayRow = CommandRow & {
  seasonSlug: string;
  venue: { lat: number; lng: number } | null;
};

/**
 * Every game placed on `date` (YYYY-MM-DD, league time) with its field,
 * teams, live ref and check-in, latest score report and the halves entered
 * so far: one query, whatever the number of games.
 */
export async function commandRows(
  db: Db,
  leagueId: LeagueId,
  date: string,
): Promise<CommandDayRow[]> {
  const rows = await db
    .select({
      id: game.id,
      status: game.status,
      slotCancelled: sql<boolean>`(${slot.status} = 'cancelled')`,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      fieldName: field.name,
      lat: venue.lat,
      lng: venue.lng,
      seasonSlug: season.slug,
      teamAId: game.teamAId,
      teamBId: game.teamBId,
      teamAName: teamA.name,
      teamBName: teamB.name,
      kicksFirst: game.kicksFirst,
      scoreA: game.scoreA,
      scoreB: game.scoreB,
      refName: user.name,
      checkedInAt: refereeAssignment.checkedInAt,
      report: sql<{ scoreA: number; scoreB: number } | null>`(
        select json_build_object('scoreA', ${scoreReport.scoreA}, 'scoreB', ${scoreReport.scoreB})
        from ${scoreReport}
        where ${scoreReport.gameId} = ${game.id}
        order by ${scoreReport.reportedAt} desc
        limit 1
      )`,
      halves: sql<HalfInning[]>`coalesce((
        select json_agg(json_build_object('inning', ${gamePeriod.periodNo}, 'half', ${gamePeriod.half}, 'runs', ${gamePeriod.runs}))
        from ${gamePeriod}
        where ${gamePeriod.gameId} = ${game.id}
      ), '[]'::json)`,
    })
    .from(game)
    .innerJoin(slot, eq(game.slotId, slot.id))
    .innerJoin(field, eq(slot.fieldId, field.id))
    .innerJoin(venue, eq(field.venueId, venue.id))
    .innerJoin(season, eq(game.seasonId, season.id))
    .innerJoin(league, eq(season.leagueId, league.id))
    .innerJoin(entryA, eq(game.teamAId, entryA.id))
    .innerJoin(teamA, eq(entryA.teamId, teamA.id))
    .innerJoin(entryB, eq(game.teamBId, entryB.id))
    .innerJoin(teamB, eq(entryB.teamId, teamB.id))
    .leftJoin(
      refereeAssignment,
      and(
        eq(refereeAssignment.gameId, game.id),
        eq(refereeAssignment.status, "accepted"),
      ),
    )
    .leftJoin(user, eq(user.id, refereeAssignment.userId))
    .where(
      and(
        eq(league.id, leagueId),
        ne(season.status, "draft"),
        sql`${localDay} = ${date}::date`,
      ),
    )
    .orderBy(asc(slot.startsAt), asc(field.name));
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    slotCancelled: r.slotCancelled,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    fieldName: r.fieldName,
    seasonSlug: r.seasonSlug,
    venue:
      r.lat !== null && r.lng !== null
        ? { lat: Number(r.lat), lng: Number(r.lng) }
        : null,
    teamA: { id: r.teamAId, name: r.teamAName },
    teamB: { id: r.teamBId, name: r.teamBName },
    kicksFirst:
      r.kicksFirst === null ? null : r.kicksFirst === r.teamAId ? "A" : "B",
    scoreA: r.scoreA,
    scoreB: r.scoreB,
    referee:
      r.refName !== null
        ? { name: r.refName, checkedInAt: r.checkedInAt }
        : null,
    report: r.report,
    halves: r.halves,
  }));
}

/**
 * The ref's "I'm at the field": checks them in to every game they referee
 * on the game's day, so a ref with three games taps once. Only accepted
 * assignments, only once (the first time stays). Returns how many changed.
 */
export async function checkInReferee(
  db: Db,
  input: { gameId: GameId; userId: UserId; now: Date },
): Promise<number> {
  const [target] = await db
    .select({
      day: sql<string>`to_char(${localDay}, 'YYYY-MM-DD')`,
      leagueId: league.id,
    })
    .from(game)
    .innerJoin(slot, eq(game.slotId, slot.id))
    .innerJoin(season, eq(game.seasonId, season.id))
    .innerJoin(league, eq(season.leagueId, league.id))
    .where(eq(game.id, input.gameId));
  if (!target) return 0;
  const sameDay = db
    .select({ id: game.id })
    .from(game)
    .innerJoin(slot, eq(game.slotId, slot.id))
    .innerJoin(season, eq(game.seasonId, season.id))
    .innerJoin(league, eq(season.leagueId, league.id))
    .where(
      and(
        eq(league.id, target.leagueId),
        sql`${localDay} = ${target.day}::date`,
      ),
    );
  const changed = await db
    .update(refereeAssignment)
    .set({ checkedInAt: input.now })
    .where(
      and(
        eq(refereeAssignment.userId, input.userId),
        eq(refereeAssignment.status, "accepted"),
        isNull(refereeAssignment.checkedInAt),
        inArray(refereeAssignment.gameId, sameDay),
      ),
    )
    .returning({ id: refereeAssignment.id });
  return changed.length;
}

/**
 * An admin checks the game's ref in for them (a ref with no phone at the
 * field). Audited, since it is done on someone else's behalf.
 */
export async function checkInRefereeFor(
  db: Db,
  input: { gameId: GameId; actorId: UserId; now: Date },
): Promise<boolean> {
  const changed = await db
    .update(refereeAssignment)
    .set({ checkedInAt: input.now })
    .where(
      and(
        eq(refereeAssignment.gameId, input.gameId),
        eq(refereeAssignment.status, "accepted"),
        isNull(refereeAssignment.checkedInAt),
      ),
    )
    .returning({ userId: refereeAssignment.userId });
  const ref = changed[0];
  if (!ref) return false;
  await recordAudit(db, {
    actorId: input.actorId,
    action: "referee.check_in",
    entityType: "game",
    entityId: input.gameId,
    after: { refereeId: ref.userId },
  });
  return true;
}

/** Whether today is the game's day (or later) for a check-in, and its teams. */
export async function gameForCheckIn(db: Db, gameId: GameId) {
  const [found] = await db
    .select({
      id: game.id,
      teamAId: game.teamAId,
      teamBId: game.teamBId,
      startsAt: slot.startsAt,
      timeZone: league.timezone,
    })
    .from(game)
    .innerJoin(slot, eq(game.slotId, slot.id))
    .innerJoin(season, eq(game.seasonId, season.id))
    .innerJoin(league, eq(season.leagueId, league.id))
    .where(eq(game.id, gameId));
  return found ?? null;
}
