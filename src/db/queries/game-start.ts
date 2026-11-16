import {
  aliasedTable,
  and,
  asc,
  eq,
  gte,
  isNotNull,
  lt,
  ne,
} from "drizzle-orm";
import {
  type HeldUpBy,
  isTight,
  type Punctuality,
  punctuality,
} from "@/domain/gameday/daylight";
import { remindsTonight } from "@/domain/equipment/equipment";
import type { GameId, SeasonId, UserId } from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import type { StartOnTimePayload } from "@/emails/start-on-time";
import {
  field,
  game,
  gameStart,
  refereeAssignment,
  slot,
  venue,
} from "../schema/game";
import { league } from "../schema/league";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import { enqueueMessages, type OutboxMessage } from "./outbox";
import { dayChangesFor, firstPitchOf, permitInfoFor } from "./permit-watch";
import type { Db } from "./schedule";
import { captainsOf } from "./score-reminders";

/**
 * When a game's first pitch was thrown, and who held up a late one (issue
 * #467). The ref (or a captain, or an admin) taps once at the field; the
 * admins' punctuality summary and the late-start log read it back.
 */

/** The start-on-time nudge goes out this long before first pitch. */
export const NUDGE_BEFORE_MS = 2 * 3_600_000;

/** How early before the slot's time a start can be recorded. */
export const EARLIEST_START_MINUTES = 30;

const CLOSED = ["final", "forfeit", "cancelled", "postponed"] as const;

export type StartError = "not_found" | "closed" | "too_early" | "not_started";

async function startable(db: Db, gameId: GameId, now: Date) {
  const [g] = await db
    .select({ status: game.status, startsAt: slot.startsAt })
    .from(game)
    .innerJoin(slot, eq(game.slotId, slot.id))
    .where(eq(game.id, gameId));
  if (!g) return err("not_found" as const);
  if ((CLOSED as readonly string[]).includes(g.status))
    return err("closed" as const);
  if (now.getTime() < g.startsAt.getTime() - EARLIEST_START_MINUTES * 60_000)
    return err("too_early" as const);
  return ok(g);
}

/**
 * Records first pitch as now. A second tap (a double tap, or a phone that
 * resends) keeps the first time: correcting it means undoing it first.
 */
export async function recordStart(
  db: Db,
  input: { gameId: GameId; userId: UserId; now: Date },
): Promise<Result<Date, StartError>> {
  const open = await startable(db, input.gameId, input.now);
  if (!open.ok) return open;
  await db
    .insert(gameStart)
    .values({
      gameId: input.gameId,
      startedAt: input.now,
      recordedBy: input.userId,
      recordedAt: input.now,
    })
    .onConflictDoNothing();
  const [row] = await db
    .select({ startedAt: gameStart.startedAt })
    .from(gameStart)
    .where(eq(gameStart.gameId, input.gameId));
  return row ? ok(row.startedAt) : err("not_found");
}

/** Takes back a start tapped by mistake, while the game is still open. */
export async function undoStart(
  db: Db,
  input: { gameId: GameId; now: Date },
): Promise<Result<true, StartError>> {
  const open = await startable(db, input.gameId, input.now);
  if (!open.ok) return open;
  await db.delete(gameStart).where(eq(gameStart.gameId, input.gameId));
  return ok(true);
}

/** Says who held up a late start; "neither" for the field, the ref or the weather. */
export async function setHeldUpBy(
  db: Db,
  input: { gameId: GameId; heldUpBy: HeldUpBy; userId: UserId; now: Date },
): Promise<Result<true, StartError>> {
  const updated = await db
    .update(gameStart)
    .set({
      heldUpBy: input.heldUpBy,
      recordedBy: input.userId,
      recordedAt: input.now,
    })
    .where(eq(gameStart.gameId, input.gameId))
    .returning({ gameId: gameStart.gameId });
  return updated.length > 0 ? ok(true) : err("not_started");
}

export type TeamPunctuality = Punctuality & { teamName: string };

/** One recorded late start, for the admins' log. */
export type LateStart = {
  gameId: GameId;
  firstPitchAt: Date;
  startedAt: Date;
  teamA: string;
  teamB: string;
  fieldName: string;
  heldUpBy: HeldUpBy | null;
};

const teamA = aliasedTable(team, "team_a");
const teamB = aliasedTable(team, "team_b");
const entryA = aliasedTable(teamSeason, "entry_a");
const entryB = aliasedTable(teamSeason, "entry_b");

/**
 * A season's recorded starts: the punctuality summary per team, and each
 * start. One query.
 */
export async function seasonStarts(
  db: Db,
  seasonId: SeasonId,
): Promise<{ teams: TeamPunctuality[]; starts: LateStart[] }> {
  const rows = await db
    .select({
      gameId: game.id,
      teamAId: game.teamAId,
      teamBId: game.teamBId,
      teamA: teamA.name,
      teamB: teamB.name,
      fieldName: field.name,
      firstPitchAt: slot.startsAt,
      startedAt: gameStart.startedAt,
      heldUpBy: gameStart.heldUpBy,
    })
    .from(gameStart)
    .innerJoin(game, eq(gameStart.gameId, game.id))
    .innerJoin(slot, eq(game.slotId, slot.id))
    .innerJoin(field, eq(slot.fieldId, field.id))
    .innerJoin(entryA, eq(game.teamAId, entryA.id))
    .innerJoin(teamA, eq(entryA.teamId, teamA.id))
    .innerJoin(entryB, eq(game.teamBId, entryB.id))
    .innerJoin(teamB, eq(entryB.teamId, teamB.id))
    .where(eq(game.seasonId, seasonId))
    .orderBy(asc(slot.startsAt), asc(field.name));
  // A delayed day's new start is when first pitch was due (#383).
  const changes = await dayChangesFor(
    db,
    rows.map((r) => r.gameId),
  );
  for (const r of rows)
    r.firstPitchAt = firstPitchOf(r.firstPitchAt, changes.get(r.gameId));
  const names = new Map<string, string>();
  for (const r of rows) {
    names.set(r.teamAId, r.teamA);
    names.set(r.teamBId, r.teamB);
  }
  return {
    // Worst first; teams level on both go by name.
    teams: punctuality(rows)
      .map((p) => ({ ...p, teamName: names.get(p.teamSeasonId) ?? "" }))
      .sort(
        (a, b) =>
          b.lateStarts - a.lateStarts ||
          b.minutesLost - a.minutesLost ||
          a.teamName.localeCompare(b.teamName),
      ),
    starts: rows.map((r) => ({
      gameId: r.gameId,
      firstPitchAt: r.firstPitchAt,
      startedAt: r.startedAt,
      teamA: r.teamA,
      teamB: r.teamB,
      fieldName: r.fieldName,
      heldUpBy: r.heldUpBy,
    })),
  };
}

/**
 * Queues the start-on-time nudges for tomorrow's games (league time) whose
 * end of play leaves no room for a late start: one for each captain and the
 * ref, timed for two hours before first pitch, when the outbox sweep through
 * the day sends it. Safe to run any number of times: each person hears once
 * per game. Returns how many were new.
 */
export async function queueStartReminders(db: Db, now: Date): Promise<number> {
  const until = new Date(now.getTime() + 36 * 3_600_000);
  const games = await db
    .select({
      id: game.id,
      teamAId: game.teamAId,
      teamBId: game.teamBId,
      teamA: teamA.name,
      teamB: teamB.name,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      fieldName: field.name,
      venueName: venue.name,
      timeZone: league.timezone,
      refereeId: refereeAssignment.userId,
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
    .where(
      and(
        eq(game.status, "scheduled"),
        eq(slot.status, "open"),
        ne(season.status, "draft"),
        isNotNull(game.slotId),
        gte(slot.startsAt, now),
        lt(slot.startsAt, until),
      ),
    );
  const tomorrow = games.filter((g) =>
    remindsTonight(g.startsAt, now, g.timeZone),
  );
  if (tomorrow.length === 0) return 0;
  const [clocks, captains] = await Promise.all([
    permitInfoFor(
      db,
      tomorrow.map((g) => g.id),
    ),
    captainsOf(
      db,
      tomorrow.flatMap((g) => [g.teamAId, g.teamBId]),
    ),
  ]);
  const messages: OutboxMessage[] = [];
  for (const g of tomorrow) {
    const clock = clocks.get(g.id);
    if (!clock || clock.dayOff) continue;
    // A delayed game's slot moves with it.
    const delay = clock.clockStartsAt.getTime() - g.startsAt.getTime();
    if (!isTight(new Date(g.endsAt.getTime() + delay), clock.end.endsAt))
      continue;
    const firstPitchAt = clock.clockStartsAt;
    const payload = (role: StartOnTimePayload["role"]): StartOnTimePayload => ({
      gameId: g.id,
      teams: `${g.teamA} vs ${g.teamB}`,
      place: `${g.venueName}, ${g.fieldName}`,
      startsAt: firstPitchAt.toISOString(),
      endsAt: clock.end.endsAt.toISOString(),
      endReason: clock.end.reason,
      sunsetAt:
        clock.end.reason === "daylight" && clock.sunsetAt
          ? clock.sunsetAt.toISOString()
          : null,
      timeZone: g.timeZone,
      role,
    });
    const people = [
      ...(g.refereeId
        ? [{ userId: g.refereeId, role: "referee" as const }]
        : []),
      ...captains
        .filter(
          (c) => c.teamSeasonId === g.teamAId || c.teamSeasonId === g.teamBId,
        )
        .map((c) => ({ userId: c.userId, role: "captain" as const })),
    ];
    const seen = new Set<string>();
    for (const p of people) {
      // A captain who also refs hears once, as the ref.
      if (seen.has(p.userId)) continue;
      seen.add(p.userId);
      messages.push({
        userId: p.userId,
        topic: "game_reminder",
        template: "start_on_time",
        payload: payload(p.role),
        dedupeKey: `start-on-time/${g.id}/${p.userId}`,
        // The outbox sweep through the day sends it two hours before.
        sendAfter: new Date(
          Math.max(now.getTime(), firstPitchAt.getTime() - NUDGE_BEFORE_MS),
        ),
      });
    }
  }
  return enqueueMessages(db, messages);
}

/** A game's recorded start, or null before first pitch. */
export async function startOf(
  db: Db,
  gameId: GameId,
): Promise<{ startedAt: Date; heldUpBy: HeldUpBy | null } | null> {
  const [row] = await db
    .select({ startedAt: gameStart.startedAt, heldUpBy: gameStart.heldUpBy })
    .from(gameStart)
    .where(eq(gameStart.gameId, gameId));
  return row ?? null;
}
