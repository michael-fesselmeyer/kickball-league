import {
  and,
  asc,
  count,
  desc,
  eq,
  isNull,
  notInArray,
  sql,
} from "drizzle-orm";
import {
  DRAW_METHOD,
  drawWinners,
  type GiveawayInput,
  type RandomInt,
} from "@/domain/drive/giveaway";
import type {
  EventId,
  GiveawayEntryId,
  GiveawayId,
  GiveawayWinnerId,
  UserId,
} from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import { newCheckinSecret } from "@/domain/sponsors/checkin-code";
import type { GiveawayWinPayload } from "@/emails/giveaway";
import { user } from "../schema/auth";
import { giveaway, giveawayEntry, giveawayWinner } from "../schema/drive";
import { event } from "../schema/event";
import { profile } from "../schema/profile";
import { recordAudit } from "./audit";
import { enqueueMessages } from "./outbox";
import type { Db } from "./schedule";

/**
 * Free event giveaways (src/domain/drive/giveaway.ts, ADR 0035): the
 * admin's giveaway, entries made by checking in at the event, and the
 * audited draw. Nothing here reads a payment, ticket or registration.
 */

export type Giveaway = GiveawayInput & {
  id: GiveawayId;
  eventId: EventId;
  drawnAt: Date | null;
};

const columns = {
  id: giveaway.id,
  eventId: giveaway.eventId,
  prize: giveaway.prize,
  donatedBy: giveaway.donatedBy,
  winnerCount: giveaway.winnerCount,
  opensAt: giveaway.opensAt,
  closesAt: giveaway.closesAt,
  officialRules: giveaway.officialRules,
  drawnAt: giveaway.drawnAt,
};

/** An event's giveaway, without its code secret. */
export async function giveawayForEvent(
  db: Db,
  eventId: EventId,
): Promise<Giveaway | null> {
  const [found] = await db
    .select(columns)
    .from(giveaway)
    .where(eq(giveaway.eventId, eventId));
  return found ?? null;
}

/** An event's giveaway with the secret, for making and checking codes. */
export async function giveawayCodeSecret(
  db: Db,
  eventId: EventId,
): Promise<{ id: GiveawayId; secret: string } | null> {
  const [found] = await db
    .select({ id: giveaway.id, secret: giveaway.checkinSecret })
    .from(giveaway)
    .where(eq(giveaway.eventId, eventId));
  return found ?? null;
}

/** An admin adds a giveaway to an event; one per event. */
export async function createGiveaway(
  db: Db,
  input: { eventId: EventId; giveaway: GiveawayInput; actorId: UserId },
): Promise<Result<GiveawayId, "exists">> {
  const [created] = await db
    .insert(giveaway)
    .values({
      eventId: input.eventId,
      ...input.giveaway,
      checkinSecret: newCheckinSecret(),
      createdBy: input.actorId,
    })
    .onConflictDoNothing({ target: giveaway.eventId })
    .returning({ id: giveaway.id });
  if (!created) return err("exists");
  await recordAudit(db, {
    actorId: input.actorId,
    action: "giveaway.create",
    entityType: "giveaway",
    entityId: created.id,
    after: { eventId: input.eventId, ...input.giveaway },
  });
  return ok(created.id);
}

/** An admin changes a giveaway, until its winners are drawn. */
export async function updateGiveaway(
  db: Db,
  input: { id: GiveawayId; giveaway: GiveawayInput; actorId: UserId },
): Promise<Result<void, "not_found" | "drawn">> {
  const [before] = await db
    .select(columns)
    .from(giveaway)
    .where(eq(giveaway.id, input.id))
    .for("update");
  if (!before) return err("not_found");
  if (before.drawnAt !== null) return err("drawn");
  await db
    .update(giveaway)
    .set(input.giveaway)
    .where(eq(giveaway.id, input.id));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "giveaway.update",
    entityType: "giveaway",
    entityId: input.id,
    before,
    after: input.giveaway,
  });
  return ok(undefined);
}

/**
 * Enters a person, once. The giveaway row is read under a share lock so an
 * entry can't slip in after the draw has started; the unique constraint
 * makes a second check-in, even at the same instant, a no-op.
 */
export async function enterGiveaway(
  db: Db,
  input: { giveawayId: GiveawayId; userId: UserId; now: Date },
): Promise<Result<{ first: boolean }, "not_found" | "closed">> {
  const [g] = await db
    .select({
      opensAt: giveaway.opensAt,
      closesAt: giveaway.closesAt,
      drawnAt: giveaway.drawnAt,
    })
    .from(giveaway)
    .where(eq(giveaway.id, input.giveawayId))
    .for("share");
  if (!g) return err("not_found");
  if (g.drawnAt !== null || input.now < g.opensAt || input.now >= g.closesAt)
    return err("closed");
  const [created] = await db
    .insert(giveawayEntry)
    .values({
      giveawayId: input.giveawayId,
      userId: input.userId,
      enteredAt: input.now,
    })
    .onConflictDoNothing({
      target: [giveawayEntry.giveawayId, giveawayEntry.userId],
    })
    .returning({ id: giveawayEntry.id });
  return ok({ first: created !== undefined });
}

/** Whether a person has entered. */
export async function hasEntered(
  db: Db,
  giveawayId: GiveawayId,
  userId: UserId,
): Promise<boolean> {
  const [found] = await db
    .select({ id: giveawayEntry.id })
    .from(giveawayEntry)
    .where(
      and(
        eq(giveawayEntry.giveawayId, giveawayId),
        eq(giveawayEntry.userId, userId),
      ),
    );
  return found !== undefined;
}

export async function entryCount(
  db: Db,
  giveawayId: GiveawayId,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(giveawayEntry)
    .where(eq(giveawayEntry.giveawayId, giveawayId));
  return row?.n ?? 0;
}

const winnerName = sql<string>`coalesce(nullif(trim(concat_ws(' ', ${profile.firstName}, ${profile.lastName})), ''), nullif(${user.name}, ''), 'A player')`;

export type DrawnWinner = {
  id: GiveawayWinnerId;
  userId: UserId;
  name: string;
  round: number;
  drawnAt: Date;
  replacedAt: Date | null;
  replacedReason: string | null;
};

/** Every winner drawn, replaced ones too, in the order they were drawn. */
export async function giveawayWinners(
  db: Db,
  giveawayId: GiveawayId,
): Promise<DrawnWinner[]> {
  return db
    .select({
      id: giveawayWinner.id,
      userId: giveawayEntry.userId,
      name: winnerName,
      round: giveawayWinner.round,
      drawnAt: giveawayWinner.drawnAt,
      replacedAt: giveawayWinner.replacedAt,
      replacedReason: giveawayWinner.replacedReason,
    })
    .from(giveawayWinner)
    .innerJoin(giveawayEntry, eq(giveawayEntry.id, giveawayWinner.entryId))
    .innerJoin(user, eq(user.id, giveawayEntry.userId))
    .leftJoin(profile, eq(profile.userId, user.id))
    .where(eq(giveawayWinner.giveawayId, giveawayId))
    .orderBy(asc(giveawayWinner.round), asc(giveawayWinner.drawnAt));
}

export type DrawError = "not_found" | "drawn" | "still_open" | "no_entries";

type Winning = { entryId: GiveawayEntryId; userId: UserId };

/** Queues the one message each new winner gets. */
async function tellWinners(
  db: Db,
  giveawayId: GiveawayId,
  winners: readonly Winning[],
  about: GiveawayWinPayload,
) {
  await enqueueMessages(
    db,
    winners.map((w) => ({
      userId: w.userId,
      template: "giveaway_win" as const,
      topic: "events" as const,
      payload: about,
      dedupeKey: `giveaway_win/${giveawayId}/${w.userId}`,
    })),
  );
}

async function lockForDraw(db: Db, giveawayId: GiveawayId) {
  const [g] = await db
    .select({
      ...columns,
      eventTitle: event.title,
      eventSlug: event.slug,
    })
    .from(giveaway)
    .innerJoin(event, eq(event.id, giveaway.eventId))
    .where(eq(giveaway.id, giveawayId))
    .for("update", { of: giveaway });
  return g;
}

/**
 * Draws the winners once entry has closed: every entry, in the order
 * people entered, through the domain's fair draw. The audit row records
 * the entry count, the method and who won (entry and account ids, no
 * names), so anyone with the log can see the draw took every entry.
 */
export async function drawGiveaway(
  db: Db,
  input: {
    giveawayId: GiveawayId;
    actorId: UserId;
    now: Date;
    randomInt?: RandomInt;
  },
): Promise<Result<Winning[], DrawError>> {
  const g = await lockForDraw(db, input.giveawayId);
  if (!g) return err("not_found");
  if (g.drawnAt !== null) return err("drawn");
  if (input.now < g.closesAt) return err("still_open");
  const entries = await db
    .select({ entryId: giveawayEntry.id, userId: giveawayEntry.userId })
    .from(giveawayEntry)
    .where(eq(giveawayEntry.giveawayId, g.id))
    .orderBy(asc(giveawayEntry.enteredAt), asc(giveawayEntry.id));
  if (entries.length === 0) return err("no_entries");
  const { winners, indexes } = drawWinners(
    entries,
    g.winnerCount,
    input.randomInt,
  );
  await db.insert(giveawayWinner).values(
    winners.map((w) => ({
      giveawayId: g.id,
      entryId: w.entryId,
      round: 1,
      drawnAt: input.now,
      drawnBy: input.actorId,
    })),
  );
  await db
    .update(giveaway)
    .set({ drawnAt: input.now })
    .where(eq(giveaway.id, g.id));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "giveaway.draw",
    entityType: "giveaway",
    entityId: g.id,
    after: {
      entryCount: entries.length,
      winnersAsked: g.winnerCount,
      method: DRAW_METHOD,
      drawnPositions: indexes,
      winners: winners.map((w) => ({ entryId: w.entryId, userId: w.userId })),
    },
  });
  await tellWinners(db, g.id, winners, {
    prize: g.prize,
    donatedBy: g.donatedBy,
    eventTitle: g.eventTitle,
    eventSlug: g.eventSlug,
  });
  return ok(winners);
}

export type RedrawError =
  "not_found" | "not_drawn" | "not_a_winner" | "no_one_left";

/**
 * Replaces one winner, with the admin's reason: draws one new winner from
 * the entries that have never won this giveaway (a replaced winner is
 * never drawn again). Audited like the draw, with the reason.
 */
export async function redrawWinner(
  db: Db,
  input: {
    giveawayId: GiveawayId;
    winnerId: GiveawayWinnerId;
    reason: string;
    actorId: UserId;
    now: Date;
    randomInt?: RandomInt;
  },
): Promise<Result<Winning, RedrawError>> {
  const g = await lockForDraw(db, input.giveawayId);
  if (!g) return err("not_found");
  if (g.drawnAt === null) return err("not_drawn");
  const [replaced] = await db
    .select({
      entryId: giveawayWinner.entryId,
      userId: giveawayEntry.userId,
      round: giveawayWinner.round,
    })
    .from(giveawayWinner)
    .innerJoin(giveawayEntry, eq(giveawayEntry.id, giveawayWinner.entryId))
    .where(
      and(
        eq(giveawayWinner.id, input.winnerId),
        eq(giveawayWinner.giveawayId, g.id),
        isNull(giveawayWinner.replacedAt),
      ),
    );
  if (!replaced) return err("not_a_winner");
  const everWon = db
    .select({ id: giveawayWinner.entryId })
    .from(giveawayWinner)
    .where(eq(giveawayWinner.giveawayId, g.id));
  const eligible = await db
    .select({ entryId: giveawayEntry.id, userId: giveawayEntry.userId })
    .from(giveawayEntry)
    .where(
      and(
        eq(giveawayEntry.giveawayId, g.id),
        notInArray(giveawayEntry.id, everWon),
      ),
    )
    .orderBy(asc(giveawayEntry.enteredAt), asc(giveawayEntry.id));
  const { winners, indexes } = drawWinners(eligible, 1, input.randomInt);
  const [next] = winners;
  if (!next) return err("no_one_left");
  const [{ last } = { last: 1 }] = await db
    .select({ last: sql<number>`max(${giveawayWinner.round})::int` })
    .from(giveawayWinner)
    .where(eq(giveawayWinner.giveawayId, g.id));
  await db
    .update(giveawayWinner)
    .set({ replacedAt: input.now, replacedReason: input.reason })
    .where(eq(giveawayWinner.id, input.winnerId));
  await db.insert(giveawayWinner).values({
    giveawayId: g.id,
    entryId: next.entryId,
    round: last + 1,
    drawnAt: input.now,
    drawnBy: input.actorId,
  });
  await recordAudit(db, {
    actorId: input.actorId,
    action: "giveaway.redraw",
    entityType: "giveaway",
    entityId: g.id,
    before: { entryId: replaced.entryId, userId: replaced.userId },
    after: {
      reason: input.reason,
      eligibleCount: eligible.length,
      method: DRAW_METHOD,
      drawnPositions: indexes,
      winner: { entryId: next.entryId, userId: next.userId },
    },
  });
  await tellWinners(db, g.id, [next], {
    prize: g.prize,
    donatedBy: g.donatedBy,
    eventTitle: g.eventTitle,
    eventSlug: g.eventSlug,
  });
  return ok(next);
}

export type MyWin = {
  prize: string;
  donatedBy: string | null;
  eventTitle: string;
  eventSlug: string;
  drawnAt: Date;
};

/** The giveaways a person has won and still holds, newest first. */
export async function myGiveawayWins(db: Db, userId: UserId): Promise<MyWin[]> {
  return db
    .select({
      prize: giveaway.prize,
      donatedBy: giveaway.donatedBy,
      eventTitle: event.title,
      eventSlug: event.slug,
      drawnAt: giveawayWinner.drawnAt,
    })
    .from(giveawayWinner)
    .innerJoin(giveawayEntry, eq(giveawayEntry.id, giveawayWinner.entryId))
    .innerJoin(giveaway, eq(giveaway.id, giveawayWinner.giveawayId))
    .innerJoin(event, eq(event.id, giveaway.eventId))
    .where(
      and(
        eq(giveawayEntry.userId, userId),
        isNull(giveawayWinner.replacedAt),
        isNull(event.deletedAt),
      ),
    )
    .orderBy(desc(giveawayWinner.drawnAt));
}

/**
 * What a player's giveaway page needs about them, in two small queries: whether
 * they entered, whether they won, and how many entered and won in all.
 */
export async function giveawayStanding(
  db: Db,
  giveawayId: GiveawayId,
  userId: UserId,
): Promise<{
  entered: boolean;
  won: boolean;
  entries: number;
  winners: number;
}> {
  const [entries] = await db
    .select({
      all: sql<number>`count(*)::int`,
      mine: sql<number>`(count(*) filter (where ${giveawayEntry.userId} = ${userId}))::int`,
    })
    .from(giveawayEntry)
    .where(eq(giveawayEntry.giveawayId, giveawayId));
  const [winners] = await db
    .select({
      all: sql<number>`count(*)::int`,
      mine: sql<number>`(count(*) filter (where ${giveawayEntry.userId} = ${userId}))::int`,
    })
    .from(giveawayWinner)
    .innerJoin(giveawayEntry, eq(giveawayEntry.id, giveawayWinner.entryId))
    .where(
      and(
        eq(giveawayWinner.giveawayId, giveawayId),
        isNull(giveawayWinner.replacedAt),
      ),
    );
  return {
    entered: (entries?.mine ?? 0) > 0,
    won: (winners?.mine ?? 0) > 0,
    entries: entries?.all ?? 0,
    winners: winners?.all ?? 0,
  };
}
