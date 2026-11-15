import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { cleanPost } from "@/domain/lost-found/rules";
import { processPhoto } from "@/lib/member-photos/process-photo";
import { withThumbnail } from "@/lib/lost-found/thumbnail";
import { auditLog } from "../schema/audit";
import { lostFoundClaim, lostFoundItem } from "../schema/lost-found";
import { message } from "../schema/message";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { deleteAccount, personalData } from "./account";
import {
  answerItem,
  board,
  closeOldItems,
  closeOwnPost,
  deleteLostFoundOf,
  handOver,
  itemDetail,
  lostFoundPhoto,
  postItem,
  removeItem,
  withdrawClaim,
  writeMessage,
} from "./lost-found";
import { photoStorage, photosInLastDay } from "./member-photos";
import type { Db } from "./schedule";
import { DAILY_POSTS } from "@/domain/lost-found/rules";
import { grantRole } from "../test/leagues";

afterAll(closePool);

const NOW = new Date("2026-10-20T22:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

async function testPhoto(seed = 1) {
  const input = await sharp({
    create: {
      width: 80,
      height: 60,
      channels: 3,
      background: { r: 40 * seed, g: 120, b: 200 },
    },
  })
    .jpeg()
    .toBuffer();
  const result = await processPhoto(input);
  if (!result.ok) throw new Error(result.error);
  return withThumbnail(result.value);
}

async function world(db: Db) {
  const w = await messagingWorld(db);
  const admin = await w.person("admin");
  await grantRole(db, admin.userId, "admin", w.leagueId);
  return {
    ...w,
    admin,
    finder: w.aces.players[0]!,
    owner: w.aces.captain,
    other: w.bees.captain,
  };
}
type World = Awaited<ReturnType<typeof world>>;

async function post(
  db: Db,
  w: World,
  over: { kind?: "found" | "lost"; photo?: boolean; now?: Date } = {},
) {
  const cleaned = cleanPost({
    kind: over.kind ?? "found",
    description: "Black cleats",
    place: "Field 3",
    whereNow: "With me",
  });
  if (!cleaned.ok) throw new Error(cleaned.error);
  const result = await postItem(db, {
    leagueId: w.leagueId,
    posterId: w.finder.userId,
    post: cleaned.value,
    photo: over.photo ? await testPhoto() : null,
    now: over.now ?? NOW,
  });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

const answer = (
  db: Db,
  w: World,
  itemId: Awaited<ReturnType<typeof post>>,
  by = w.owner,
) =>
  answerItem(db, {
    leagueId: w.leagueId,
    itemId,
    responderId: by.userId,
    message: "Those are mine, size 10",
    now: NOW,
  });

describe("the board", () => {
  it("lists open posts newest first, found and lost apart, by first name", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const older = await post(db, w, { now: ago(2) });
      const newer = await post(db, w, { now: ago(1) });
      const lost = await post(db, w, { kind: "lost" });
      const b = await board(db, {
        leagueId: w.leagueId,
        viewerId: w.owner.userId,
      });
      expect(b.found.map((i) => i.id)).toEqual([newer, older]);
      expect(b.lost.map((i) => i.id)).toEqual([lost]);
      expect(b.found[0]!.posterName).not.toContain(" ");
      expect(b.found[0]!.mine).toBe(false);
    }));

  it("keeps another league's posts off the board and out of reach", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const other = await messagingWorld(db);
      const id = await post(db, w);
      const b = await board(db, {
        leagueId: other.leagueId,
        viewerId: w.owner.userId,
      });
      expect(b.found).toEqual([]);
      expect(
        await itemDetail(db, {
          leagueId: other.leagueId,
          itemId: id,
          viewerId: w.owner.userId,
        }),
      ).toBeNull();
    }));

  it("stops a person posting more than the daily limit", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      for (let i = 0; i < DAILY_POSTS; i++) await post(db, w);
      const cleaned = cleanPost({
        kind: "lost",
        description: "Keys",
        place: "Bar",
        whereNow: "",
      });
      if (!cleaned.ok) throw new Error();
      expect(
        await postItem(db, {
          leagueId: w.leagueId,
          posterId: w.finder.userId,
          post: cleaned.value,
          photo: null,
          now: NOW,
        }),
      ).toEqual({ ok: false, error: "daily_posts" });
    }));
});

describe("photos", () => {
  it("stores a thumbnail and serves both sizes to open posts only", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await post(db, w, { photo: true });
      const full = await lostFoundPhoto(db, id, "full");
      const thumb = await lostFoundPhoto(db, id, "thumb");
      expect(full?.bytes.length).toBeGreaterThan(0);
      expect(thumb?.sha256).toBe(`${full?.sha256}-thumb`);
      await closeOwnPost(db, {
        leagueId: w.leagueId,
        itemId: id,
        posterId: w.finder.userId,
        now: NOW,
      });
      expect(await lostFoundPhoto(db, id, "full")).toBeNull();
    }));

  it("counts toward the league's storage cap, and the cap refuses a photo only", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      await post(db, w, { photo: true });
      expect((await photoStorage(db, w.leagueId)).usedBytes).toBeGreaterThan(0);
      const cleaned = cleanPost({
        kind: "lost",
        description: "Keys",
        place: "Bar",
        whereNow: "",
      });
      if (!cleaned.ok) throw new Error();
      const base = {
        leagueId: w.leagueId,
        posterId: w.finder.userId,
        post: cleaned.value,
        now: NOW,
        capBytes: 10,
      };
      expect(await postItem(db, { ...base, photo: await testPhoto() })).toEqual(
        { ok: false, error: "league_full" },
      );
      expect((await postItem(db, { ...base, photo: null })).ok).toBe(true);
    }));

  it("counts photo posts toward the daily photo total shared with member photos", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      await post(db, w, { photo: true });
      await post(db, w, { photo: true });
      await post(db, w);
      expect(await photosInLastDay(db, w.finder.userId, NOW)).toBe(2);
      expect(
        await photosInLastDay(
          db,
          w.finder.userId,
          new Date(NOW.getTime() + 2 * DAY),
        ),
      ).toBe(0);
    }));
});

describe("answers", () => {
  it("opens a conversation and tells the poster, with no contact details", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await post(db, w);
      const r = await answer(db, w, id);
      expect(r.ok).toBe(true);
      const sent = await db
        .select()
        .from(message)
        .where(eq(message.userId, w.finder.userId));
      const notice = sent.find((m) => m.template === "lost_found_reply");
      expect(notice?.topic).toBe("lost_found");
      expect(JSON.stringify(notice?.payload)).not.toContain("@");
      const mine = await itemDetail(db, {
        leagueId: w.leagueId,
        itemId: id,
        viewerId: w.finder.userId,
      });
      expect(mine?.claims).toHaveLength(1);
      expect(mine?.claims[0]?.messages[0]?.body).toBe(
        "Those are mine, size 10",
      );
    }));

  it("refuses the finder answering their own post", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await post(db, w);
      expect(await answer(db, w, id, w.finder)).toEqual({
        ok: false,
        error: "own_post",
      });
    }));

  it("takes one answer per person, even after they withdrew", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await post(db, w);
      const first = await answer(db, w, id);
      if (!first.ok) throw new Error();
      expect(await answer(db, w, id)).toEqual({
        ok: false,
        error: "already_answered",
      });
      await withdrawClaim(db, {
        leagueId: w.leagueId,
        claimId: first.value,
        responderId: w.owner.userId,
        now: NOW,
      });
      expect(await answer(db, w, id)).toEqual({
        ok: false,
        error: "already_answered",
      });
    }));

  it("lets two people answer one item and hands it to one, telling the other", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await post(db, w, { photo: true });
      const a = await answer(db, w, id, w.owner);
      const b = await answer(db, w, id, w.other);
      if (!a.ok || !b.ok) throw new Error();
      expect(
        await handOver(db, {
          leagueId: w.leagueId,
          itemId: id,
          claimId: a.value,
          posterId: w.finder.userId,
          now: NOW,
        }),
      ).toEqual({ ok: true, value: undefined });
      const claims = await db
        .select()
        .from(lostFoundClaim)
        .where(eq(lostFoundClaim.itemId, id));
      expect(Object.fromEntries(claims.map((c) => [c.id, c.status]))).toEqual({
        [a.value]: "handed_over",
        [b.value]: "closed",
      });
      const [item] = await db
        .select()
        .from(lostFoundItem)
        .where(eq(lostFoundItem.id, id));
      expect(item).toMatchObject({
        status: "returned",
        bytes: null,
        thumbBytes: null,
      });
      const toOther = await db
        .select()
        .from(message)
        .where(eq(message.userId, w.other.userId));
      expect(
        toOther.map((m) => (m.payload as { kind: string }).kind),
      ).toContain("answer_closed");
      const toWinner = await db
        .select()
        .from(message)
        .where(eq(message.userId, w.owner.userId));
      expect(
        toWinner.map((m) => (m.payload as { kind: string }).kind),
      ).toContain("handed_over");
      // Closed: no more answers or messages.
      expect((await answer(db, w, id, w.admin)).ok).toBe(false);
      expect(
        await writeMessage(db, {
          leagueId: w.leagueId,
          claimId: b.value,
          authorId: w.other.userId,
          body: "hi",
          now: NOW,
        }),
      ).toEqual({ ok: false, error: "closed" });
    }));

  it("only the poster can hand over, and not to a withdrawn answer", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await post(db, w);
      const a = await answer(db, w, id);
      if (!a.ok) throw new Error();
      expect(
        (
          await handOver(db, {
            leagueId: w.leagueId,
            itemId: id,
            claimId: a.value,
            posterId: w.owner.userId,
            now: NOW,
          })
        ).ok,
      ).toBe(false);
      await withdrawClaim(db, {
        leagueId: w.leagueId,
        claimId: a.value,
        responderId: w.owner.userId,
        now: NOW,
      });
      expect(
        (
          await handOver(db, {
            leagueId: w.leagueId,
            itemId: id,
            claimId: a.value,
            posterId: w.finder.userId,
            now: NOW,
          })
        ).ok,
      ).toBe(false);
    }));

  it("caps the open answers on one post", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await post(db, w);
      const people = [
        w.owner,
        w.other,
        w.aces.players[1]!,
        w.bees.players[0]!,
        w.bees.players[1]!,
        w.freeAgent,
      ];
      const results = [];
      for (const p of people) results.push(await answer(db, w, id, p));
      expect(results.filter((r) => r.ok)).toHaveLength(5);
      expect(results[5]).toEqual({ ok: false, error: "too_many" });
    }));
});

describe("conversations", () => {
  it("lets only the two people read and write, and tells the other each time", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await post(db, w);
      const a = await answer(db, w, id);
      if (!a.ok) throw new Error();
      const say = (by: typeof w.owner, body = "On my way") =>
        writeMessage(db, {
          leagueId: w.leagueId,
          claimId: a.value,
          authorId: by.userId,
          body,
          now: NOW,
        });
      expect((await say(w.finder)).ok).toBe(true);
      expect((await say(w.owner)).ok).toBe(true);
      // A third member, and an admin, can't write or see it.
      expect(await say(w.other)).toEqual({ ok: false, error: "not_found" });
      expect(await say(w.admin)).toEqual({ ok: false, error: "not_found" });
      expect(await say(w.owner, "  ")).toEqual({ ok: false, error: "empty" });
      expect(await say(w.owner, "x".repeat(501))).toEqual({
        ok: false,
        error: "too_long",
      });
      for (const viewer of [w.other, w.admin]) {
        const d = await itemDetail(db, {
          leagueId: w.leagueId,
          itemId: id,
          viewerId: viewer.userId,
        });
        expect(d?.claims).toEqual([]);
      }
      const toFinder = await db
        .select()
        .from(message)
        .where(eq(message.userId, w.finder.userId));
      expect(
        toFinder.filter(
          (m) => (m.payload as { kind: string }).kind === "reply",
        ),
      ).toHaveLength(1);
    }));
});

describe("closing", () => {
  it("an admin removes a post with an open answer: answerers and the poster are told, and it is audited", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await post(db, w, { photo: true });
      const a = await answer(db, w, id);
      if (!a.ok) throw new Error();
      expect(
        await removeItem(db, {
          leagueId: w.leagueId,
          itemId: id,
          actorId: w.admin.userId,
          now: NOW,
        }),
      ).toEqual({ ok: true, value: undefined });
      const [item] = await db
        .select()
        .from(lostFoundItem)
        .where(eq(lostFoundItem.id, id));
      expect(item).toMatchObject({ status: "removed", bytes: null });
      const [claim] = await db
        .select()
        .from(lostFoundClaim)
        .where(eq(lostFoundClaim.id, a.value));
      expect(claim?.status).toBe("closed");
      const kinds = async (u: typeof w.owner) =>
        (
          await db.select().from(message).where(eq(message.userId, u.userId))
        ).map((m) => (m.payload as { kind: string }).kind);
      expect(await kinds(w.owner)).toContain("answer_closed");
      expect(await kinds(w.finder)).toContain("removed");
      const audit = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.entityId, id));
      expect(audit.map((r) => r.action)).toContain("lost_found.remove");
      expect(
        await removeItem(db, {
          leagueId: w.leagueId,
          itemId: id,
          actorId: w.admin.userId,
          now: NOW,
        }),
      ).toEqual({ ok: false, error: "not_open" });
    }));

  it("the daily job closes posts after 30 days, tells the poster once, and later deletes the row", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const fresh = await post(db, w, { now: ago(29) });
      const old = await post(db, w, { now: ago(31), photo: true });
      const claim = await answer(db, w, old);
      if (!claim.ok) throw new Error();
      expect(await closeOldItems(db, NOW)).toEqual({ expired: 1, deleted: 0 });
      expect(await closeOldItems(db, NOW)).toEqual({ expired: 0, deleted: 0 });
      const [item] = await db
        .select()
        .from(lostFoundItem)
        .where(eq(lostFoundItem.id, old));
      expect(item).toMatchObject({ status: "expired", bytes: null });
      const [still] = await db
        .select()
        .from(lostFoundItem)
        .where(eq(lostFoundItem.id, fresh));
      expect(still?.status).toBe("open");
      const toPoster = await db
        .select()
        .from(message)
        .where(eq(message.dedupeKey, `lost_found_expired:${old}`));
      expect(toPoster).toHaveLength(1);
      const later = new Date(NOW.getTime() + 91 * DAY);
      expect((await closeOldItems(db, later)).deleted).toBe(1);
    }));

  it("lets the poster close their own post and refuses anyone else", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await post(db, w);
      expect(
        (
          await closeOwnPost(db, {
            leagueId: w.leagueId,
            itemId: id,
            posterId: w.owner.userId,
            now: NOW,
          })
        ).ok,
      ).toBe(false);
      expect(
        (
          await closeOwnPost(db, {
            leagueId: w.leagueId,
            itemId: id,
            posterId: w.finder.userId,
            now: NOW,
          })
        ).ok,
      ).toBe(true);
    }));
});

describe("deleting an account", () => {
  it("deletes the person's posts and answers and leaves others' posts open", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const mine = await post(db, w, { photo: true });
      const theirs = await post(db, w);
      await answer(db, w, theirs);
      const counts = await deleteLostFoundOf(db, w.owner.userId);
      expect(counts).toEqual({ posts: 0, answers: 1 });
      const [t] = await db
        .select()
        .from(lostFoundItem)
        .where(eq(lostFoundItem.id, theirs));
      expect(t?.status).toBe("open");
      expect((await deleteLostFoundOf(db, w.finder.userId)).posts).toBe(2);
      expect(
        await db.select().from(lostFoundItem).where(eq(lostFoundItem.id, mine)),
      ).toEqual([]);
    }));

  it("is part of deleting the account and of the data download", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await post(db, w);
      const player = w.bees.players[0]!;
      await answer(db, w, id, player);
      const data = await personalData(db, player.userId, NOW);
      expect(JSON.stringify(data)).toContain("Those are mine, size 10");
      expect((await deleteAccount(db, player.userId, NOW)).ok).toBe(true);
      expect(
        await db
          .select()
          .from(lostFoundClaim)
          .where(eq(lostFoundClaim.itemId, id)),
      ).toEqual([]);
    }));
});
