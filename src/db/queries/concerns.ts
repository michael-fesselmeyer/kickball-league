import { and, asc, count, desc, eq, isNotNull, lt, sql } from "drizzle-orm";
import type { ConcernId, GameId, LeagueId, TeamId, UserId } from "@/domain/ids";
import {
  type ConcernInput,
  KEEP_EMAIL_MONTHS,
} from "@/domain/concerns/concerns";
import { err, ok, type Result } from "@/domain/result";
import { concern, concernMessage } from "../schema/concern";
import { user } from "../schema/auth";
import { game } from "../schema/game";
import { season } from "../schema/season";
import { recordAudit } from "./audit";
import { enqueueMessages } from "./outbox";
import type { Db } from "./schedule";

type Step = "received" | "reply" | "closed";

/**
 * The email to the sender for one step: to their account when they sent it
 * signed in, else to the address they left, else nothing. One per concern
 * and step, so a retry never sends twice; replies are numbered by message.
 */
function updateMessage(
  c: { id: ConcernId; senderId: UserId | null; replyEmail: string | null },
  p: { step: Step; leagueName: string; text: string; key: string; now: Date },
) {
  if (!c.senderId && !c.replyEmail) return [];
  return [
    {
      userId: c.senderId,
      recipientEmail: c.senderId ? null : c.replyEmail,
      // The league's official correspondence: always delivered, not in settings.
      topic: "discipline" as const,
      template: "concern_update" as const,
      payload: {
        step: p.step,
        leagueName: p.leagueName,
        text: p.text,
        inApp: c.senderId !== null,
      },
      dedupeKey: `concern/${c.id}/${p.key}`,
      sendAfter: p.now,
    },
  ];
}

/**
 * Saves a concern from the public form (no sender) or a signed-in player,
 * and queues the "we got it" email when there is somewhere to send it.
 */
export async function submitConcern(
  db: Db,
  input: {
    leagueId: LeagueId;
    leagueName: string;
    source: "public" | "player";
    senderId: UserId | null;
    gameId?: GameId | null;
    teamId?: TeamId | null;
    form: ConcernInput;
    now: Date;
  },
): Promise<ConcernId> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(concern)
      .values({
        leagueId: input.leagueId,
        source: input.source,
        category: input.form.category,
        parkRule: input.form.parkRule,
        body: input.form.body,
        occurredOn: input.form.occurredOn,
        place: input.form.place,
        senderId: input.senderId,
        gameId: input.gameId ?? null,
        teamId: input.teamId ?? null,
        replyEmail: input.source === "public" ? input.form.replyEmail : null,
        createdAt: input.now,
      })
      .returning({
        id: concern.id,
        senderId: concern.senderId,
        replyEmail: concern.replyEmail,
      });
    if (!row) throw new Error("The concern was not saved");
    await recordAudit(tx, {
      actorId: input.senderId,
      action: "concern.send",
      entityType: "concern",
      entityId: row.id,
      leagueId: input.leagueId,
      // The text and address stay out of the log; it records that one came in.
      after: { source: input.source, category: input.form.category },
    });
    await enqueueMessages(
      tx,
      updateMessage(row, {
        step: "received",
        leagueName: input.leagueName,
        text: "",
        key: "received",
        now: input.now,
      }),
    );
    return row.id;
  });
}

export type ConcernRow = {
  id: ConcernId;
  source: "public" | "player";
  category: typeof concern.$inferSelect.category;
  parkRule: typeof concern.$inferSelect.parkRule;
  body: string;
  status: "open" | "closed";
  createdAt: Date;
  firstRepliedAt: Date | null;
  closedAt: Date | null;
};

const rowColumns = {
  id: concern.id,
  source: concern.source,
  category: concern.category,
  parkRule: concern.parkRule,
  body: concern.body,
  status: concern.status,
  createdAt: concern.createdAt,
  firstRepliedAt: concern.firstRepliedAt,
  closedAt: concern.closedAt,
};

/**
 * The league's queue: open concerns oldest first, the most recently closed,
 * and how fast the league answers (the share of the last 90 days' concerns
 * with a first reply inside a day). Never reads a sender's address.
 */
export async function concernQueue(db: Db, leagueId: LeagueId, now: Date) {
  const since = new Date(now.getTime() - 90 * 24 * 3600_000);
  const [open, closed, [stats]] = await Promise.all([
    db
      .select(rowColumns)
      .from(concern)
      .where(and(eq(concern.leagueId, leagueId), eq(concern.status, "open")))
      .orderBy(asc(concern.createdAt))
      .limit(200),
    db
      .select(rowColumns)
      .from(concern)
      .where(and(eq(concern.leagueId, leagueId), eq(concern.status, "closed")))
      .orderBy(desc(concern.closedAt))
      .limit(20),
    db
      .select({
        total: count(),
        quick: sql<number>`count(*) filter (where ${concern.firstRepliedAt} - ${concern.createdAt} <= interval '1 day')::int`,
      })
      .from(concern)
      .where(
        and(
          eq(concern.leagueId, leagueId),
          sql`${concern.createdAt} >= ${since}`,
          // Only those with someone to answer: a signed-in sender or an address.
          sql`(${concern.senderId} is not null or ${concern.replyEmail} is not null or ${concern.firstRepliedAt} is not null)`,
        ),
      ),
  ]);
  return {
    open,
    closed,
    answeredInDay: { total: stats?.total ?? 0, quick: stats?.quick ?? 0 },
  };
}

/** Open concerns per league, for the admin dashboard's badge. */
export async function openConcernCount(db: Db, leagueId: LeagueId) {
  const [row] = await db
    .select({ n: count() })
    .from(concern)
    .where(and(eq(concern.leagueId, leagueId), eq(concern.status, "open")));
  return row?.n ?? 0;
}

/**
 * One concern with its thread. Reading a sender's address is an audit
 * entry, so who looked is on record.
 */
export async function concernDetail(db: Db, id: ConcernId, readerId: UserId) {
  const [row] = await db
    .select({
      ...rowColumns,
      leagueId: concern.leagueId,
      occurredOn: concern.occurredOn,
      place: concern.place,
      gameId: concern.gameId,
      senderId: concern.senderId,
      replyEmail: concern.replyEmail,
      outcome: concern.outcome,
      senderName: user.name,
    })
    .from(concern)
    .leftJoin(user, eq(user.id, concern.senderId))
    .where(eq(concern.id, id));
  if (!row) return null;
  if (row.replyEmail)
    await recordAudit(db, {
      actorId: readerId,
      action: "concern.read",
      entityType: "concern",
      entityId: id,
      leagueId: row.leagueId,
    });
  const thread = await db
    .select({
      id: concernMessage.id,
      kind: concernMessage.kind,
      body: concernMessage.body,
      createdAt: concernMessage.createdAt,
    })
    .from(concernMessage)
    .where(eq(concernMessage.concernId, id))
    .orderBy(asc(concernMessage.createdAt));
  return { ...row, thread };
}

export type ConcernError =
  "not_found" | "closed" | "not_closed" | "no_reply_to";

async function lock(tx: Db, id: ConcernId) {
  const [row] = await tx
    .select({
      id: concern.id,
      leagueId: concern.leagueId,
      status: concern.status,
      senderId: concern.senderId,
      replyEmail: concern.replyEmail,
      firstRepliedAt: concern.firstRepliedAt,
    })
    .from(concern)
    .where(eq(concern.id, id))
    .for("update");
  return row ?? null;
}

/** A reply to the sender, emailed; or an admin-only note. */
export async function addConcernMessage(
  db: Db,
  input: {
    concernId: ConcernId;
    authorId: UserId;
    kind: "reply" | "note";
    body: string;
    leagueName: string;
    now: Date;
  },
): Promise<Result<void, ConcernError>> {
  return db.transaction(async (tx) => {
    const c = await lock(tx, input.concernId);
    if (!c) return err("not_found");
    if (c.status === "closed") return err("closed");
    if (input.kind === "reply" && !c.senderId && !c.replyEmail)
      return err("no_reply_to");
    const [saved] = await tx
      .insert(concernMessage)
      .values({
        concernId: c.id,
        authorId: input.authorId,
        kind: input.kind,
        body: input.body,
        createdAt: input.now,
      })
      .returning({ id: concernMessage.id });
    if (input.kind === "reply") {
      if (!c.firstRepliedAt)
        await tx
          .update(concern)
          .set({ firstRepliedAt: input.now })
          .where(eq(concern.id, c.id));
      await enqueueMessages(
        tx,
        updateMessage(c, {
          step: "reply",
          leagueName: input.leagueName,
          text: input.body,
          key: `reply/${saved?.id}`,
          now: input.now,
        }),
      );
    }
    await recordAudit(tx, {
      actorId: input.authorId,
      action: input.kind === "reply" ? "concern.reply" : "concern.note",
      entityType: "concern",
      entityId: c.id,
      leagueId: c.leagueId,
    });
    return ok(undefined);
  });
}

/** Closes a concern with what was done, and tells the sender. */
export async function closeConcern(
  db: Db,
  input: {
    concernId: ConcernId;
    actorId: UserId;
    outcome: string;
    leagueName: string;
    now: Date;
  },
): Promise<Result<void, ConcernError>> {
  return db.transaction(async (tx) => {
    const c = await lock(tx, input.concernId);
    if (!c) return err("not_found");
    if (c.status === "closed") return err("closed");
    await tx
      .update(concern)
      .set({
        status: "closed",
        closedAt: input.now,
        closedBy: input.actorId,
        outcome: input.outcome,
      })
      .where(eq(concern.id, c.id));
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "concern.close",
      entityType: "concern",
      entityId: c.id,
      leagueId: c.leagueId,
    });
    await enqueueMessages(
      tx,
      updateMessage(c, {
        step: "closed",
        leagueName: input.leagueName,
        text: input.outcome,
        key: "closed",
        now: input.now,
      }),
    );
    return ok(undefined);
  });
}

/** Opens a closed concern again. The sender is not emailed. */
export async function reopenConcern(
  db: Db,
  input: { concernId: ConcernId; actorId: UserId },
): Promise<Result<void, ConcernError>> {
  return db.transaction(async (tx) => {
    const c = await lock(tx, input.concernId);
    if (!c) return err("not_found");
    if (c.status === "open") return err("not_closed");
    await tx
      .update(concern)
      .set({ status: "open", closedAt: null, closedBy: null })
      .where(eq(concern.id, c.id));
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "concern.reopen",
      entityType: "concern",
      entityId: c.id,
      leagueId: c.leagueId,
    });
    return ok(undefined);
  });
}

/**
 * Clears the reply address of concerns closed more than 12 months ago, and
 * deletes the emails queued to that address. Returns how many concerns.
 */
export async function purgeConcernEmails(db: Db, now: Date): Promise<number> {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - KEEP_EMAIL_MONTHS);
  return db.transaction(async (tx) => {
    const gone = await tx
      .update(concern)
      .set({ replyEmail: null })
      .where(and(isNotNull(concern.replyEmail), lt(concern.closedAt, cutoff)))
      .returning({ id: concern.id });
    if (gone.length > 0)
      await tx.execute(
        sql`delete from message where recipient_email is not null and dedupe_key like any (${sql.raw(
          `array[${gone.map((g) => `'concern/${g.id}/%'`).join(",")}]`,
        )})`,
      );
    return gone.length;
  });
}

/** A signed-in player's own concerns, newest first. Never anyone else's. */
export async function myConcerns(db: Db, userId: UserId) {
  return db
    .select({
      id: concern.id,
      category: concern.category,
      status: concern.status,
      createdAt: concern.createdAt,
      closedAt: concern.closedAt,
    })
    .from(concern)
    .where(eq(concern.senderId, userId))
    .orderBy(desc(concern.createdAt))
    .limit(100);
}

/**
 * One of the player's own concerns with the league's replies and what was
 * done. Admin notes are never returned, and a concern that is not theirs
 * reads as missing.
 */
export async function myConcernDetail(db: Db, id: ConcernId, userId: UserId) {
  const [row] = await db
    .select({
      id: concern.id,
      category: concern.category,
      body: concern.body,
      status: concern.status,
      createdAt: concern.createdAt,
      closedAt: concern.closedAt,
      outcome: concern.outcome,
    })
    .from(concern)
    .where(and(eq(concern.id, id), eq(concern.senderId, userId)));
  if (!row) return null;
  const replies = await db
    .select({
      id: concernMessage.id,
      body: concernMessage.body,
      createdAt: concernMessage.createdAt,
    })
    .from(concernMessage)
    .where(
      and(eq(concernMessage.concernId, id), eq(concernMessage.kind, "reply")),
    )
    .orderBy(asc(concernMessage.createdAt));
  return { ...row, replies };
}

/** Whether a game exists in the league, for an optional game link. */
export async function gameInLeague(
  db: Db,
  gameId: GameId,
  leagueId: LeagueId,
): Promise<boolean> {
  const [row] = await db
    .select({ id: game.id })
    .from(game)
    .innerJoin(season, eq(season.id, game.seasonId))
    .where(and(eq(game.id, gameId), eq(season.leagueId, leagueId)));
  return row !== undefined;
}
