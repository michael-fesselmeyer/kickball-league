import { and, asc, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import type { LeagueId, SeasonId, UserId } from "@/domain/ids";
import { kickoff, shortDay } from "@/domain/schedule/format";
import { localDay } from "@/domain/schedule/public-game";
import type { RainRisk, Window } from "@/domain/weather/forecast";
import {
  DECISION_UNTIL_MS,
  type Decision,
  dueForDecision,
} from "@/domain/weather/decision";
import type { RainDecisionPayload } from "@/emails/rain-decision";
import type { RainoutRequestPayload } from "@/emails/rainout-request";
import { auditLog } from "../schema/audit";
import { user } from "../schema/auth";
import { field, game, slot, venue } from "../schema/game";
import { league } from "../schema/league";
import { profile } from "../schema/profile";
import { gamePlacement, scheduleVersion } from "../schema/schedule";
import { recordAudit } from "./audit";
import { enqueueMessages, type OutboxMessage } from "./outbox";
import { type GameDay, gameDaysDue } from "./rain-alerts";
import type { Db } from "./schedule";

/**
 * Owner-confirmed rain-outs (ADR 0048). Admins prepare a rain-out and send
 * it to the owners; an owner (or the operator, or an admin when the owners
 * allow it) confirms it. A few hours before each game day, whoever can
 * confirm hears what the park's weather says. Nothing here cancels a game.
 */

/** Whether the owners let admins confirm rain-outs. */
export async function adminsConfirmRainouts(
  db: Db,
  leagueId: LeagueId,
): Promise<boolean> {
  const [row] = await db
    .select({ on: league.adminsConfirmRainouts })
    .from(league)
    .where(eq(league.id, leagueId));
  return row?.on ?? false;
}

/** An owner changes who may confirm; audited, and a no-op when unchanged. */
export async function setAdminsConfirmRainouts(
  db: Db,
  input: { leagueId: LeagueId; actorId: UserId; on: boolean },
): Promise<boolean> {
  const [before] = await db
    .select({ on: league.adminsConfirmRainouts })
    .from(league)
    .where(eq(league.id, input.leagueId))
    .for("update");
  if (!before || before.on === input.on) return false;
  await db
    .update(league)
    .set({ adminsConfirmRainouts: input.on })
    .where(eq(league.id, input.leagueId));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "rainout.confirm_policy",
    entityType: "league",
    entityId: input.leagueId,
    before: { adminsConfirm: before.on },
    after: { adminsConfirm: input.on },
  });
  return true;
}

/** One park's games on a game day, for its decision card. */
export type ParkGames = {
  venue: string;
  lat: number;
  lng: number;
  games: Window[];
};

/**
 * The parks a season plays at on a date (YYYY-MM-DD, league time), with
 * their games from the published schedule. Parks with no map pin have no
 * forecast and are left out.
 */
export async function gameDayParks(
  db: Db,
  seasonId: SeasonId,
  date: string,
  timeZone: string,
): Promise<ParkGames[]> {
  // The day's games lie within a day either side of UTC midnight.
  const from = new Date(`${date}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 1);
  const until = new Date(from.getTime() + 3 * 86_400_000);
  const rows = await db
    .select({
      venueId: venue.id,
      venue: venue.name,
      lat: venue.lat,
      lng: venue.lng,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
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
    .innerJoin(slot, eq(gamePlacement.slotId, slot.id))
    .innerJoin(field, eq(slot.fieldId, field.id))
    .innerJoin(venue, eq(field.venueId, venue.id))
    .where(
      and(
        eq(game.seasonId, seasonId),
        ne(game.status, "cancelled"),
        gte(slot.startsAt, from),
        lt(slot.startsAt, until),
      ),
    )
    .orderBy(asc(venue.name), asc(slot.startsAt));
  const parks = new Map<string, ParkGames>();
  for (const r of rows) {
    if (r.lat === null || r.lng === null) continue;
    if (localDay(r.startsAt, timeZone) !== date) continue;
    const park = parks.get(r.venueId) ?? {
      venue: r.venue,
      lat: Number(r.lat),
      lng: Number(r.lng),
      games: [],
    };
    park.games.push({ startsAt: r.startsAt, endsAt: r.endsAt });
    parks.set(r.venueId, park);
  }
  return [...parks.values()];
}

/** Everyone who confirms rain-outs: the owners, and admins when allowed. */
async function confirmers(db: Db, leagueId: LeagueId): Promise<UserId[]> {
  const roles: ("owner" | "admin")[] = (await adminsConfirmRainouts(
    db,
    leagueId,
  ))
    ? ["owner", "admin"]
    : ["owner"];
  const rows = await db
    .select({ id: user.id })
    .from(profile)
    .innerJoin(user, eq(profile.userId, user.id))
    .where(inArray(profile.globalRole, roles))
    .orderBy(asc(user.id));
  return rows.map((r) => r.id);
}

const requestKey = (seasonId: SeasonId, date: string, owner: UserId) =>
  `rainout-request/${seasonId}/${date}/${owner}`;

/**
 * An admin sends a rain-out to the owners to confirm: an audit row, and one
 * urgent message to each owner. Sending the same day again writes another
 * audit row but messages nobody twice. Returns how many were messaged.
 */
export async function sendRainoutToOwners(
  db: Db,
  input: {
    leagueId: LeagueId;
    season: { id: SeasonId; slug: string; name: string };
    date: string;
    day: string;
    actorId: UserId;
    actorName: string;
    summary: string | null;
    now: Date;
  },
): Promise<number> {
  await recordAudit(db, {
    actorId: input.actorId,
    action: "rainout.prepare",
    entityType: "season",
    entityId: input.season.id,
    after: { date: input.date, summary: input.summary },
  });
  const owners = await db
    .select({ id: user.id })
    .from(profile)
    .innerJoin(user, eq(profile.userId, user.id))
    .where(eq(profile.globalRole, "owner"));
  const payload = {
    seasonName: input.season.name,
    seasonSlug: input.season.slug,
    date: input.date,
    day: input.day,
    from: input.actorName,
    summary: input.summary,
  } satisfies RainoutRequestPayload;
  const messages: OutboxMessage[] = owners
    .filter((o) => o.id !== input.actorId)
    .map((o) => ({
      userId: o.id,
      topic: "rainout",
      template: "rainout_request",
      payload,
      dedupeKey: requestKey(input.season.id, input.date, o.id),
      sendAfter: input.now,
    }));
  return messages.length > 0 ? enqueueMessages(db, messages) : 0;
}

export type RainoutRequest = { at: Date; by: string | null };

/** Who sent a season's date to the owners, and when, newest first. */
export async function rainoutRequests(
  db: Db,
  seasonId: SeasonId,
  date: string,
): Promise<RainoutRequest[]> {
  const rows = await db
    .select({ at: auditLog.occurredAt, by: user.name })
    .from(auditLog)
    .leftJoin(user, eq(auditLog.actorId, user.id))
    .where(
      and(
        eq(auditLog.entityType, "season"),
        eq(auditLog.entityId, seasonId),
        eq(auditLog.action, "rainout.prepare"),
        sql`${auditLog.after}->>'date' = ${date}`,
      ),
    )
    .orderBy(desc(auditLog.occurredAt))
    .limit(5);
  return rows;
}

/** Game days whose first pitch is 2 to 8 hours away: due their decision alert. */
export function gameDaysForDecision(db: Db, now: Date): Promise<GameDay[]> {
  return gameDaysDue(db, now, dueForDecision, DECISION_UNTIL_MS);
}

export type DecisionCheck = {
  day: GameDay;
  /** The worst park's decision; its summary goes in the alert. */
  decision: Decision;
  /** That park's name, said when a day has more than one. */
  park: string;
  parks: number;
};

const RANK: Record<RainRisk, number> = { low: 0, watch: 1, likely: 2 };

/** The worst of a day's parks, which is the one the alert is about. */
export function worstPark(
  decisions: readonly { park: string; decision: Decision }[],
): { park: string; decision: Decision } | null {
  return decisions.reduce<{ park: string; decision: Decision } | null>(
    (a, b) =>
      a === null || RANK[b.decision.level] > RANK[a.decision.level] ? b : a,
    null,
  );
}

/**
 * Queues the decision-time alert for each game day on watch or likely, to
 * everyone who confirms rain-outs, once per game day: the dedupe key names
 * the day and the person, so a second run that day, or a later level, sends
 * nothing more. Returns how many were new.
 */
export async function queueDecisionAlerts(
  db: Db,
  leagueId: LeagueId,
  checks: readonly DecisionCheck[],
  now: Date,
): Promise<number> {
  const alerting = checks.filter(
    (c) => c.decision.level !== "low" && !c.decision.blind,
  );
  if (alerting.length === 0) return 0;
  const recipients = await confirmers(db, leagueId);
  const messages: OutboxMessage[] = [];
  for (const { day, decision, park, parks } of alerting) {
    const payload = {
      seasonName: day.seasonName,
      seasonSlug: day.seasonSlug,
      date: day.date,
      day: shortDay(day.firstPitch, day.timeZone),
      firstPitch: kickoff(day.firstPitch, day.timeZone),
      games: day.games.length,
      level: decision.level === "likely" ? "likely" : "watch",
      summary: parks > 1 ? `${park}: ${decision.summary}` : decision.summary,
    } satisfies RainDecisionPayload;
    for (const userId of recipients)
      messages.push({
        userId,
        topic: "rainout",
        template: "rain_decision",
        payload,
        dedupeKey: `rain-decision/${day.seasonId}/${day.date}/${userId}`,
        sendAfter: now,
      });
  }
  return messages.length > 0 ? enqueueMessages(db, messages) : 0;
}
