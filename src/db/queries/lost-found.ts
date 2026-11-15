import { and, asc, desc, eq, inArray, lt, ne, sql } from "drizzle-orm";
import type {
  LeagueId,
  LostFoundClaimId,
  LostFoundItemId,
  LostFoundMessageId,
  UserId,
} from "@/domain/ids";
import {
  type CleanPost,
  type ClaimProblem,
  type ClaimStatus,
  checkClaim,
  CLOSED_KEEP_DAYS,
  cleanMessage,
  firstName,
  ITEM_LIFE_DAYS,
  type ItemKind,
  type ItemStatus,
  type MessageProblem,
  underDailyPostLimit,
} from "@/domain/lost-found/rules";
import { fitsLeagueCap, underDailyLimit } from "@/domain/member-photos/limits";
import { err, ok, type Result } from "@/domain/result";
import type {
  LostFoundReplyPayload,
  LostFoundUpdatePayload,
} from "@/emails/lost-found";
import { user } from "../schema/auth";
import {
  lostFoundClaim,
  lostFoundItem,
  lostFoundMessage,
} from "../schema/lost-found";
import { recordAudit } from "./audit";
import { withinActionLimit } from "./action-limits";
import { photosInLastDay, photoStorage } from "./member-photos";
import { enqueueMessages, type OutboxMessage } from "./outbox";
import type { Db } from "./schedule";

/**
 * The lost and found board (issue #385; docs/data-model.md, section 2.8):
 * posts, the answers to them, the conversation between the poster and each
 * answerer, and the ways a post closes. Nobody's contact details appear
 * anywhere here: people are shown by first name only and talk in the app.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Where the board lives, for the links in messages. */
export const BOARD_PATH = "/app/lost-and-found";
const itemPath = (id: LostFoundItemId) => `${BOARD_PATH}/${id}`;

/** A photo ready to store: the shrunk copy and its thumbnail. */
export type BoardPhoto = {
  bytes: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
  sha256: string;
};

export type PostError = "daily_posts" | "daily_cap" | "league_full";

export type PostInput = {
  leagueId: LeagueId;
  posterId: UserId;
  post: CleanPost;
  photo: BoardPhoto | null;
  now: Date;
  /** The league's storage cap; tests pass a small one. */
  capBytes?: number;
};

/**
 * Adds a post. A photo is checked against the member-photo limits: the
 * person's daily photo limit and the league's storage cap, shared with
 * member photos. Posts take turns per league (the same transaction lock as
 * photo uploads), so two at once can't both fit the last space. When a
 * photo is refused the caller can offer to post without one.
 */
export async function postItem(
  db: Db,
  input: PostInput,
): Promise<Result<LostFoundItemId, PostError>> {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`member_photo:${input.leagueId}`}))`,
  );
  const [recent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(lostFoundItem)
    .where(
      and(
        eq(lostFoundItem.posterId, input.posterId),
        sql`${lostFoundItem.createdAt} >= ${new Date(input.now.getTime() - DAY_MS)}`,
      ),
    );
  if (!underDailyPostLimit(recent?.n ?? 0)) return err("daily_posts");
  if (input.photo) {
    if (!underDailyLimit(await photosInLastDay(db, input.posterId, input.now)))
      return err("daily_cap");
    const { usedBytes } = await photoStorage(db, input.leagueId);
    const size = input.photo.bytes.length + input.photo.thumb.length;
    if (!fitsLeagueCap(usedBytes, size, input.capBytes))
      return err("league_full");
  }
  const [row] = await db
    .insert(lostFoundItem)
    .values({
      leagueId: input.leagueId,
      posterId: input.posterId,
      kind: input.post.kind,
      description: input.post.description,
      place: input.post.place,
      whereNow: input.post.whereNow,
      hadPhoto: input.photo !== null,
      bytes: input.photo?.bytes ?? null,
      byteSize: input.photo?.bytes.length ?? null,
      thumbBytes: input.photo?.thumb ?? null,
      width: input.photo?.width ?? null,
      height: input.photo?.height ?? null,
      sha256: input.photo?.sha256 ?? null,
      createdAt: input.now,
    })
    .returning({ id: lostFoundItem.id });
  if (!row) throw new Error("lost and found post not stored");
  return ok(row.id);
}

export type BoardItem = {
  id: LostFoundItemId;
  kind: ItemKind;
  description: string;
  place: string;
  whereNow: string | null;
  hasPhoto: boolean;
  postedAt: Date;
  posterName: string;
  mine: boolean;
  /** For the viewer's own posts: answers waiting. */
  openClaims: number;
  /** For others' posts: whether the viewer already answered. */
  answered: boolean;
};

/** The most posts each list shows. */
const BOARD_LIMIT = 100;

/**
 * The board: open found items and open lost notes, each newest first, with
 * the poster's first name. One query for the posts and one for the answers
 * that matter to the viewer.
 */
export async function board(
  db: Db,
  input: { leagueId: LeagueId; viewerId: UserId },
): Promise<{ found: BoardItem[]; lost: BoardItem[] }> {
  const list = (kind: ItemKind) =>
    db
      .select({
        id: lostFoundItem.id,
        kind: lostFoundItem.kind,
        description: lostFoundItem.description,
        place: lostFoundItem.place,
        whereNow: lostFoundItem.whereNow,
        hasPhoto: sql<boolean>`${lostFoundItem.thumbBytes} is not null`,
        postedAt: lostFoundItem.createdAt,
        posterId: lostFoundItem.posterId,
        posterName: user.name,
      })
      .from(lostFoundItem)
      .innerJoin(user, eq(user.id, lostFoundItem.posterId))
      .where(
        and(
          eq(lostFoundItem.leagueId, input.leagueId),
          eq(lostFoundItem.status, "open"),
          eq(lostFoundItem.kind, kind),
        ),
      )
      .orderBy(desc(lostFoundItem.createdAt), desc(lostFoundItem.id))
      .limit(BOARD_LIMIT);
  const [found, lost] = await Promise.all([list("found"), list("lost")]);
  const ids = [...found, ...lost].map((i) => i.id);
  const claims =
    ids.length === 0
      ? []
      : await db
          .select({
            itemId: lostFoundClaim.itemId,
            responderId: lostFoundClaim.responderId,
            status: lostFoundClaim.status,
          })
          .from(lostFoundClaim)
          .where(inArray(lostFoundClaim.itemId, ids));
  const shape = (rows: typeof found): BoardItem[] =>
    rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      description: r.description,
      place: r.place,
      whereNow: r.whereNow,
      hasPhoto: r.hasPhoto,
      postedAt: r.postedAt,
      posterName: firstName(r.posterName),
      mine: r.posterId === input.viewerId,
      openClaims: claims.filter((c) => c.itemId === r.id && c.status === "open")
        .length,
      answered: claims.some(
        (c) => c.itemId === r.id && c.responderId === input.viewerId,
      ),
    }));
  return { found: shape(found), lost: shape(lost) };
}

export type ThreadMessage = {
  id: LostFoundMessageId;
  mine: boolean;
  authorName: string;
  body: string;
  createdAt: Date;
};

export type ItemClaim = {
  id: LostFoundClaimId;
  status: ClaimStatus;
  responderName: string;
  createdAt: Date;
  messages: ThreadMessage[];
};

export type ItemDetail = {
  id: LostFoundItemId;
  kind: ItemKind;
  status: ItemStatus;
  description: string;
  place: string;
  whereNow: string | null;
  hasPhoto: boolean;
  width: number | null;
  height: number | null;
  postedAt: Date;
  closedAt: Date | null;
  posterId: UserId;
  posterName: string;
  mine: boolean;
  /**
   * The poster sees every answer with its thread; an answerer sees only
   * their own. Anyone else, and an admin, sees none: the conversations are
   * between the two people.
   */
  claims: ItemClaim[];
};

/** One post, with the conversations the viewer is part of. */
export async function itemDetail(
  db: Db,
  input: { leagueId: LeagueId; itemId: LostFoundItemId; viewerId: UserId },
): Promise<ItemDetail | null> {
  const [row] = await db
    .select({
      id: lostFoundItem.id,
      kind: lostFoundItem.kind,
      status: lostFoundItem.status,
      description: lostFoundItem.description,
      place: lostFoundItem.place,
      whereNow: lostFoundItem.whereNow,
      hasPhoto: sql<boolean>`${lostFoundItem.thumbBytes} is not null`,
      width: lostFoundItem.width,
      height: lostFoundItem.height,
      postedAt: lostFoundItem.createdAt,
      closedAt: lostFoundItem.closedAt,
      posterId: lostFoundItem.posterId,
      posterName: user.name,
    })
    .from(lostFoundItem)
    .innerJoin(user, eq(user.id, lostFoundItem.posterId))
    .where(
      and(
        eq(lostFoundItem.id, input.itemId),
        eq(lostFoundItem.leagueId, input.leagueId),
      ),
    );
  if (!row) return null;
  const mine = row.posterId === input.viewerId;
  const claimRows = await db
    .select({
      id: lostFoundClaim.id,
      status: lostFoundClaim.status,
      createdAt: lostFoundClaim.createdAt,
      responderId: lostFoundClaim.responderId,
      responderName: user.name,
    })
    .from(lostFoundClaim)
    .innerJoin(user, eq(user.id, lostFoundClaim.responderId))
    .where(
      and(
        eq(lostFoundClaim.itemId, input.itemId),
        mine ? undefined : eq(lostFoundClaim.responderId, input.viewerId),
      ),
    )
    .orderBy(asc(lostFoundClaim.createdAt));
  const messages =
    claimRows.length === 0
      ? []
      : await db
          .select({
            id: lostFoundMessage.id,
            claimId: lostFoundMessage.claimId,
            authorId: lostFoundMessage.authorId,
            authorName: user.name,
            body: lostFoundMessage.body,
            createdAt: lostFoundMessage.createdAt,
          })
          .from(lostFoundMessage)
          .innerJoin(user, eq(user.id, lostFoundMessage.authorId))
          .where(
            inArray(
              lostFoundMessage.claimId,
              claimRows.map((c) => c.id),
            ),
          )
          .orderBy(asc(lostFoundMessage.createdAt), asc(lostFoundMessage.id));
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    description: row.description,
    place: row.place,
    whereNow: row.whereNow,
    hasPhoto: row.hasPhoto,
    width: row.width,
    height: row.height,
    postedAt: row.postedAt,
    closedAt: row.closedAt,
    posterId: row.posterId,
    posterName: firstName(row.posterName),
    mine,
    claims: claimRows.map((c) => ({
      id: c.id,
      status: c.status,
      responderName: firstName(c.responderName),
      createdAt: c.createdAt,
      messages: messages
        .filter((m) => m.claimId === c.id)
        .map((m) => ({
          id: m.id,
          mine: m.authorId === input.viewerId,
          authorName: firstName(m.authorName),
          body: m.body,
          createdAt: m.createdAt,
        })),
    })),
  };
}

/** The stored photo or thumbnail, with the league it belongs to. */
export async function lostFoundPhoto(
  db: Db,
  itemId: LostFoundItemId,
  size: "full" | "thumb",
) {
  const [row] = await db
    .select({
      leagueId: lostFoundItem.leagueId,
      contentType: lostFoundItem.contentType,
      bytes: lostFoundItem.bytes,
      thumbBytes: lostFoundItem.thumbBytes,
      sha256: lostFoundItem.sha256,
    })
    .from(lostFoundItem)
    .where(and(eq(lostFoundItem.id, itemId), eq(lostFoundItem.status, "open")));
  const bytes = size === "thumb" ? row?.thumbBytes : row?.bytes;
  if (!row || !bytes || !row.sha256) return null;
  return {
    leagueId: row.leagueId,
    contentType: row.contentType,
    bytes,
    sha256: size === "thumb" ? `${row.sha256}-thumb` : row.sha256,
  };
}

const noticeToReply = (
  userId: UserId,
  key: string,
  payload: LostFoundReplyPayload,
  now: Date,
): OutboxMessage => ({
  userId,
  topic: "lost_found",
  template: "lost_found_reply",
  payload,
  dedupeKey: key,
  sendAfter: now,
});

const noticeToUpdate = (
  userId: UserId,
  key: string,
  payload: LostFoundUpdatePayload,
  now: Date,
): OutboxMessage => ({
  userId,
  topic: "lost_found",
  template: "lost_found_update",
  payload,
  dedupeKey: key,
  sendAfter: now,
});

/** The items' columns a transition clears: the photo goes with the post. */
const NO_PHOTO = {
  bytes: null,
  byteSize: null,
  thumbBytes: null,
  width: null,
  height: null,
  sha256: null,
} as const;

/** A locked open post, for the changes that must not race. */
async function lockOpenItem(
  db: Db,
  input: { leagueId: LeagueId; itemId: LostFoundItemId },
) {
  const [row] = await db
    .select({
      id: lostFoundItem.id,
      kind: lostFoundItem.kind,
      status: lostFoundItem.status,
      description: lostFoundItem.description,
      posterId: lostFoundItem.posterId,
    })
    .from(lostFoundItem)
    .where(
      and(
        eq(lostFoundItem.id, input.itemId),
        eq(lostFoundItem.leagueId, input.leagueId),
      ),
    )
    .for("update");
  return row ?? null;
}

export type AnswerError = ClaimProblem | "not_found" | "limit" | MessageProblem;

/**
 * "That's mine" on a found item, or "I found it" on a lost note. Opens a
 * conversation with the poster, who is told at once (an urgent notice, not
 * counted against their daily limit). The first message is optional.
 */
export async function answerItem(
  db: Db,
  input: {
    leagueId: LeagueId;
    itemId: LostFoundItemId;
    responderId: UserId;
    message: string;
    now: Date;
  },
): Promise<Result<LostFoundClaimId, AnswerError>> {
  const item = await lockOpenItem(db, input);
  if (!item) return err("not_found");
  const [earlier] = await db
    .select({ status: lostFoundClaim.status })
    .from(lostFoundClaim)
    .where(
      and(
        eq(lostFoundClaim.itemId, item.id),
        eq(lostFoundClaim.responderId, input.responderId),
      ),
    );
  const [open] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(lostFoundClaim)
    .where(
      and(
        eq(lostFoundClaim.itemId, item.id),
        eq(lostFoundClaim.status, "open"),
      ),
    );
  const checked = checkClaim({
    posterId: item.posterId,
    responderId: input.responderId,
    status: item.status,
    earlier: earlier?.status ?? null,
    openClaims: open?.n ?? 0,
  });
  if (!checked.ok) return checked;
  let text: string | null = null;
  if (input.message.trim()) {
    const cleaned = cleanMessage(input.message);
    if (!cleaned.ok) return cleaned;
    text = cleaned.value;
  }
  if (
    !(await withinActionLimit(
      db,
      "lost_found_answer",
      input.responderId,
      input.now,
    ))
  )
    return err("limit");
  const [claim] = await db
    .insert(lostFoundClaim)
    .values({
      itemId: item.id,
      responderId: input.responderId,
      createdAt: input.now,
    })
    .returning({ id: lostFoundClaim.id });
  if (!claim) throw new Error("answer not stored");
  if (text)
    await db.insert(lostFoundMessage).values({
      claimId: claim.id,
      authorId: input.responderId,
      body: text,
      createdAt: input.now,
    });
  const [responder] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, input.responderId));
  await enqueueMessages(db, [
    noticeToReply(
      item.posterId,
      `lost_found_claim:${claim.id}`,
      {
        kind: "claim",
        postKind: item.kind,
        from: firstName(responder?.name ?? ""),
        item: item.description,
        path: itemPath(item.id),
      },
      input.now,
    ),
  ]);
  return ok(claim.id);
}

export type WriteError = "not_found" | "closed" | "limit" | MessageProblem;

/**
 * A message in a conversation, from either of its two people while the
 * post and the answer are both open. The other person is told.
 */
export async function writeMessage(
  db: Db,
  input: {
    leagueId: LeagueId;
    claimId: LostFoundClaimId;
    authorId: UserId;
    body: string;
    now: Date;
  },
): Promise<Result<LostFoundMessageId, WriteError>> {
  const [found] = await db
    .select({
      itemId: lostFoundClaim.itemId,
      responderId: lostFoundClaim.responderId,
    })
    .from(lostFoundClaim)
    .innerJoin(lostFoundItem, eq(lostFoundItem.id, lostFoundClaim.itemId))
    .where(
      and(
        eq(lostFoundClaim.id, input.claimId),
        eq(lostFoundItem.leagueId, input.leagueId),
      ),
    );
  if (!found) return err("not_found");
  const item = await lockOpenItem(db, {
    leagueId: input.leagueId,
    itemId: found.itemId,
  });
  if (!item) return err("not_found");
  const isParty =
    input.authorId === item.posterId || input.authorId === found.responderId;
  // Someone else's conversation looks like no conversation.
  if (!isParty) return err("not_found");
  const [claim] = await db
    .select({ status: lostFoundClaim.status })
    .from(lostFoundClaim)
    .where(eq(lostFoundClaim.id, input.claimId));
  if (item.status !== "open" || claim?.status !== "open") return err("closed");
  const body = cleanMessage(input.body);
  if (!body.ok) return body;
  if (
    !(await withinActionLimit(
      db,
      "lost_found_message",
      input.authorId,
      input.now,
    ))
  )
    return err("limit");
  const [row] = await db
    .insert(lostFoundMessage)
    .values({
      claimId: input.claimId,
      authorId: input.authorId,
      body: body.value,
      createdAt: input.now,
    })
    .returning({ id: lostFoundMessage.id });
  if (!row) throw new Error("message not stored");
  const [author] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, input.authorId));
  const to =
    input.authorId === item.posterId ? found.responderId : item.posterId;
  await enqueueMessages(db, [
    noticeToReply(
      to,
      `lost_found_message:${row.id}`,
      {
        kind: "reply",
        postKind: item.kind,
        from: firstName(author?.name ?? ""),
        item: item.description,
        path: itemPath(item.id),
      },
      input.now,
    ),
  ]);
  return ok(row.id);
}

/** The answerer takes their answer back. */
export async function withdrawClaim(
  db: Db,
  input: {
    leagueId: LeagueId;
    claimId: LostFoundClaimId;
    responderId: UserId;
    now: Date;
  },
): Promise<Result<void, "not_found">> {
  const rows = await db
    .update(lostFoundClaim)
    .set({ status: "withdrawn", closedAt: input.now })
    .where(
      and(
        eq(lostFoundClaim.id, input.claimId),
        eq(lostFoundClaim.responderId, input.responderId),
        eq(lostFoundClaim.status, "open"),
        inArray(
          lostFoundClaim.itemId,
          db
            .select({ id: lostFoundItem.id })
            .from(lostFoundItem)
            .where(eq(lostFoundItem.leagueId, input.leagueId)),
        ),
      ),
    )
    .returning({ id: lostFoundClaim.id });
  return rows.length === 0 ? err("not_found") : ok(undefined);
}

export type CloseReason = "returned" | "closed" | "expired" | "removed";

/**
 * Closes a locked open post: its photo goes, its open answers close (each
 * answerer is told, except the one it was handed to), and `notify` says
 * what the poster is told. Shared by every way a post ends.
 */
async function closeLocked(
  db: Db,
  item: {
    id: LostFoundItemId;
    kind: ItemKind;
    description: string;
    posterId: UserId;
  },
  how: {
    reason: CloseReason;
    now: Date;
    /** The answer the post was handed to, for "returned". */
    handedTo?: LostFoundClaimId;
    removedBy?: UserId;
    /** Tell the poster why (expired and removed posts). */
    tellPoster?: "expired" | "removed" | undefined;
  },
): Promise<void> {
  await db
    .update(lostFoundItem)
    .set({
      status: how.reason,
      closedAt: how.now,
      removedBy: how.removedBy ?? null,
      ...NO_PHOTO,
    })
    .where(eq(lostFoundItem.id, item.id));
  const open = await db
    .select({
      id: lostFoundClaim.id,
      responderId: lostFoundClaim.responderId,
    })
    .from(lostFoundClaim)
    .where(
      and(
        eq(lostFoundClaim.itemId, item.id),
        eq(lostFoundClaim.status, "open"),
      ),
    );
  const notices: OutboxMessage[] = [];
  for (const c of open) {
    const handed = c.id === how.handedTo;
    notices.push(
      noticeToUpdate(
        c.responderId,
        `lost_found_closed:${c.id}`,
        {
          kind: handed ? "handed_over" : "answer_closed",
          postKind: item.kind,
          item: item.description,
          path: itemPath(item.id),
        },
        how.now,
      ),
    );
  }
  if (open.length > 0)
    await db
      .update(lostFoundClaim)
      .set({ status: "closed", closedAt: how.now })
      .where(
        and(
          eq(lostFoundClaim.itemId, item.id),
          eq(lostFoundClaim.status, "open"),
          how.handedTo ? ne(lostFoundClaim.id, how.handedTo) : undefined,
        ),
      );
  if (how.handedTo)
    await db
      .update(lostFoundClaim)
      .set({ status: "handed_over", closedAt: how.now })
      .where(eq(lostFoundClaim.id, how.handedTo));
  if (how.tellPoster)
    notices.push(
      noticeToUpdate(
        item.posterId,
        `lost_found_${how.tellPoster}:${item.id}`,
        {
          kind: how.tellPoster,
          postKind: item.kind,
          item: item.description,
          path: BOARD_PATH,
        },
        how.now,
      ),
    );
  await enqueueMessages(db, notices);
}

export type CloseError = "not_found" | "not_open";

/**
 * The poster marks a post as handed over to one of its answers. The photo
 * goes, the other answers close and their people are told.
 */
export async function handOver(
  db: Db,
  input: {
    leagueId: LeagueId;
    itemId: LostFoundItemId;
    claimId: LostFoundClaimId;
    posterId: UserId;
    now: Date;
  },
): Promise<Result<void, CloseError>> {
  const item = await lockOpenItem(db, input);
  if (!item || item.posterId !== input.posterId) return err("not_found");
  if (item.status !== "open") return err("not_open");
  const [claim] = await db
    .select({ status: lostFoundClaim.status })
    .from(lostFoundClaim)
    .where(
      and(
        eq(lostFoundClaim.id, input.claimId),
        eq(lostFoundClaim.itemId, item.id),
      ),
    );
  // A withdrawn or closed answer can't be handed anything.
  if (claim?.status !== "open") return err("not_found");
  await closeLocked(db, item, {
    reason: "returned",
    now: input.now,
    handedTo: input.claimId,
  });
  return ok(undefined);
}

/** The poster takes their own post down (sorted another way, or a mistake). */
export async function closeOwnPost(
  db: Db,
  input: {
    leagueId: LeagueId;
    itemId: LostFoundItemId;
    posterId: UserId;
    now: Date;
  },
): Promise<Result<void, CloseError>> {
  const item = await lockOpenItem(db, input);
  if (!item || item.posterId !== input.posterId) return err("not_found");
  if (item.status !== "open") return err("not_open");
  await closeLocked(db, item, { reason: "closed", now: input.now });
  return ok(undefined);
}

/**
 * An admin takes any post down. Open answers close and their people are
 * told; the poster is told too. In the audit log, without the post's words.
 */
export async function removeItem(
  db: Db,
  input: {
    leagueId: LeagueId;
    itemId: LostFoundItemId;
    actorId: UserId;
    now: Date;
  },
): Promise<Result<void, CloseError>> {
  const item = await lockOpenItem(db, input);
  if (!item) return err("not_found");
  if (item.status !== "open") return err("not_open");
  await closeLocked(db, item, {
    reason: "removed",
    now: input.now,
    removedBy: input.actorId,
    // An admin taking down their own post needs no notice.
    tellPoster: item.posterId === input.actorId ? undefined : "removed",
  });
  await recordAudit(db, {
    actorId: input.actorId,
    action: "lost_found.remove",
    entityType: "lost_found_item",
    leagueId: input.leagueId,
    entityId: input.itemId,
    before: { status: "open", kind: item.kind },
    after: { status: "removed" },
  });
  return ok(undefined);
}

/**
 * The daily job: closes every open post older than 30 days, telling its
 * poster and the people with open answers, then deletes closed posts older
 * than 90 days. Safe to run twice: each notice has a dedupe key.
 */
export async function closeOldItems(
  db: Db,
  now: Date,
): Promise<{ expired: number; deleted: number }> {
  const cutoff = new Date(now.getTime() - ITEM_LIFE_DAYS * DAY_MS);
  const old = await db
    .select({ id: lostFoundItem.id, leagueId: lostFoundItem.leagueId })
    .from(lostFoundItem)
    .where(
      and(
        eq(lostFoundItem.status, "open"),
        lt(lostFoundItem.createdAt, cutoff),
      ),
    );
  let expired = 0;
  for (const { id, leagueId } of old) {
    // Re-read under the lock: it may have closed since the list was made.
    const item = await lockOpenItem(db, { leagueId, itemId: id });
    if (!item || item.status !== "open") continue;
    await closeLocked(db, item, {
      reason: "expired",
      now,
      tellPoster: "expired",
    });
    expired += 1;
  }
  const gone = await db
    .delete(lostFoundItem)
    .where(
      and(
        ne(lostFoundItem.status, "open"),
        lt(
          lostFoundItem.closedAt,
          new Date(now.getTime() - CLOSED_KEEP_DAYS * DAY_MS),
        ),
      ),
    )
    .returning({ id: lostFoundItem.id });
  return { expired, deleted: gone.length };
}

/**
 * Removes everything a person has on the board when they delete their
 * account: their posts (with the conversations on them) and their answers
 * to others' posts. Each post they answered is left as it was.
 */
export async function deleteLostFoundOf(
  db: Db,
  userId: UserId,
): Promise<{ posts: number; answers: number }> {
  const posts = await db
    .delete(lostFoundItem)
    .where(eq(lostFoundItem.posterId, userId))
    .returning({ id: lostFoundItem.id });
  const answers = await db
    .delete(lostFoundClaim)
    .where(eq(lostFoundClaim.responderId, userId))
    .returning({ id: lostFoundClaim.id });
  return { posts: posts.length, answers: answers.length };
}

/** A person's own board activity, for the download of their data. */
export async function myLostFoundData(db: Db, userId: UserId) {
  const posts = await db
    .select({
      kind: lostFoundItem.kind,
      description: lostFoundItem.description,
      place: lostFoundItem.place,
      whereNow: lostFoundItem.whereNow,
      status: lostFoundItem.status,
      postedAt: lostFoundItem.createdAt,
      closedAt: lostFoundItem.closedAt,
    })
    .from(lostFoundItem)
    .where(eq(lostFoundItem.posterId, userId))
    .orderBy(desc(lostFoundItem.createdAt));
  const answers = await db
    .select({
      item: lostFoundItem.description,
      status: lostFoundClaim.status,
      answeredAt: lostFoundClaim.createdAt,
    })
    .from(lostFoundClaim)
    .innerJoin(lostFoundItem, eq(lostFoundItem.id, lostFoundClaim.itemId))
    .where(eq(lostFoundClaim.responderId, userId))
    .orderBy(desc(lostFoundClaim.createdAt));
  const messages = await db
    .select({
      body: lostFoundMessage.body,
      sentAt: lostFoundMessage.createdAt,
    })
    .from(lostFoundMessage)
    .where(eq(lostFoundMessage.authorId, userId))
    .orderBy(desc(lostFoundMessage.createdAt));
  return { posts, answers, messages };
}
