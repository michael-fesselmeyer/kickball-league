import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { SocialPostId } from "@/domain/ids";
import { syncAll, refreshAll } from "@/lib/social/sync";
import { decryptToken } from "@/lib/social/token-crypto";
import { recentPosts } from "@/services/instagram";
import {
  EXPIRED_FIXTURE_TOKEN,
  fixtureFetch,
} from "@/services/instagram-fixture";
import media from "@/services/fixtures/instagram/media.json";
import { auditLog } from "../schema/audit";
import { user } from "../schema/auth";
import { league } from "../schema/league";
import { message } from "../schema/message";
import { profile } from "../schema/profile";
import { socialAccount, socialImage, socialPost } from "../schema/social";
import { team } from "../schema/team";
import { closePool, inRolledBackDb } from "../test/transaction";
import type { Db } from "./schedule";
import sharp from "sharp";
import { KEEP_RECENT } from "@/domain/social/storage";
import { STORED_WIDTH } from "@/lib/social/compress-photo";
import type { RecentPost } from "@/services/instagram";
import {
  adminPosts,
  applySync,
  connectedAccounts,
  curatePost,
  disconnect,
  homePhotos,
  instagramAccount,
  needsReconnect,
  saveConnection,
  setShowNewest,
  STORAGE_FULL_MESSAGE,
  storedImage,
  storedImageBytes,
  teamPhotos,
} from "./social";

afterAll(closePool);

// A stand-in for the auth secret: long enough, plainly not a real one.
const SECRET = "x".repeat(40);
const NOW = new Date("2026-11-01T12:00:00Z");
const LATER = new Date("2026-11-09T12:00:00Z");
const app = { fetch: fixtureFetch() };

async function world(db: Db) {
  const tag = Math.random().toString(36).slice(2, 8);
  const [l] = await db
    .insert(league)
    .values({ name: "Photo League", slug: `photo-${tag}` })
    .returning({ id: league.id });
  const leagueId = l!.id;
  const [admin] = await db
    .insert(user)
    .values({ name: "Addie Admin", email: `admin-${tag}@example.test` })
    .returning({ id: user.id });
  const adminId = admin!.id;
  await db.insert(profile).values({ userId: adminId, globalRole: "admin" });
  const teams = await db
    .insert(team)
    .values([
      { leagueId, name: "Sun Kickers", slug: `sun-${tag}` },
      { leagueId, name: "Big Kicks", slug: `big-${tag}` },
    ])
    .returning({ id: team.id });
  return {
    leagueId,
    adminId,
    sun: teams[0]!.id,
    big: teams[1]!.id,
  };
}

async function connect(
  db: Db,
  w: Awaited<ReturnType<typeof world>>,
  token = "fixture-long-lived-token",
) {
  return saveConnection(db, {
    leagueId: w.leagueId,
    profile: { externalId: "17841400000000001", username: "league.example" },
    token: { accessToken: token, expiresAt: new Date("2027-01-01T00:00:00Z") },
    secret: SECRET,
    actorId: w.adminId,
    now: NOW,
  });
}

const postId = async (db: Db, externalId: string) => {
  const [row] = await db
    .select({ id: socialPost.id })
    .from(socialPost)
    .where(eq(socialPost.externalId, externalId));
  return row!.id;
};

describe("saveConnection", () => {
  it("stores the token encrypted and bound to its row, and audits it", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await connect(db, w);
      const [row] = await db
        .select()
        .from(socialAccount)
        .where(eq(socialAccount.id, id));
      expect(row?.tokenCiphertext).not.toContain("fixture");
      expect(
        decryptToken(row!.tokenCiphertext!, SECRET, `social_account:${id}`),
      ).toBe("fixture-long-lived-token");
      expect(await instagramAccount(db, w.leagueId)).toMatchObject({
        username: "league.example",
        status: "active",
      });
      const audit = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.entityId, id));
      expect(audit.map((a) => a.action)).toEqual(["instagram.connect"]);
    });
  });

  it("keeps posts on reconnecting the same account, and drops them for another account", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await connect(db, w);
      await syncAll(db, app, SECRET, NOW);
      await connect(db, w);
      expect(await adminPosts(db, w.leagueId)).toHaveLength(5);
      await saveConnection(db, {
        leagueId: w.leagueId,
        profile: { externalId: "999", username: "someone.else" },
        token: { accessToken: "x", expiresAt: NOW },
        secret: SECRET,
        actorId: w.adminId,
        now: NOW,
      });
      expect(await adminPosts(db, w.leagueId)).toHaveLength(0);
      expect((await instagramAccount(db, w.leagueId))?.id).toBe(id);
    });
  });
});

describe("sync", () => {
  it("copies each new post's photo once, and running it again changes nothing", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await connect(db, w);
      const [first] = await syncAll(db, app, SECRET, NOW);
      expect(first).toMatchObject({ added: 5, updated: 0, removed: 0 });
      const [second] = await syncAll(db, app, SECRET, LATER);
      expect(second).toMatchObject({ added: 0, updated: 5, removed: 0 });

      const posts = await adminPosts(db, w.leagueId);
      expect(posts.map((p) => p.permalink)).toContain(
        "https://www.instagram.com/p/FixtureChampionship/",
      );
      const image = await storedImage(db, posts[0]!.imageId!);
      // Stored as one compressed WebP copy, not the original.
      expect(image?.contentType).toBe("image/webp");
      const meta = await sharp(image!.bytes).metadata();
      expect(meta.format).toBe("webp");
      expect(meta.width).toBeLessThanOrEqual(STORED_WIDTH);
      expect((await instagramAccount(db, w.leagueId))?.lastSyncedAt).toEqual(
        LATER,
      );
    });
  });

  it("removes a post deleted on Instagram and keeps every admin choice on the rest", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await connect(db, w);
      await syncAll(db, app, SECRET, NOW);
      const champ = await postId(db, "18000000000000001");
      const team = await postId(db, "18000000000000003");
      await curatePost(db, {
        leagueId: w.leagueId,
        postId: champ,
        change: { kind: "hide", on: true },
        actorId: w.adminId,
      });
      await curatePost(db, {
        leagueId: w.leagueId,
        postId: team,
        change: { kind: "team", teamId: w.sun },
        actorId: w.adminId,
      });

      // The opening-day post is deleted on Instagram; the others' captions change.
      const edited = {
        data: media.data
          .filter((m) => m.id !== "18000000000000006")
          .map((m) => ({ ...m, caption: `Edited: ${m.caption ?? ""}` })),
      };
      const [outcome] = await syncAll(
        db,
        { fetch: fixtureFetch({ media: edited }) },
        SECRET,
        LATER,
      );
      expect(outcome).toMatchObject({ added: 0, removed: 1 });
      const posts = await adminPosts(db, w.leagueId);
      const gone = await db
        .select({ id: socialPost.id })
        .from(socialPost)
        .where(eq(socialPost.externalId, "18000000000000006"));
      expect(gone).toEqual([]);
      expect(posts).toHaveLength(4);
      const byId = new Map(posts.map((p) => [p.id, p]));
      expect(byId.get(champ)).toMatchObject({ hidden: true, featured: false });
      expect(byId.get(champ)?.caption).toMatch(/^Edited: /);
      expect(byId.get(team)?.teamId).toBe(w.sun);
      // The deleted post's photo went with it.
      const images = await db.select({ id: socialImage.id }).from(socialImage);
      expect(
        images.filter((i) => posts.some((p) => p.imageId === i.id)),
      ).toHaveLength(4);
    });
  });

  it("leaves a post whose photo can't be copied for the next sync", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await connect(db, w);
      const missing =
        "https://scontent-lga3-1.cdninstagram.com/v/t51.fixture/team-photo.jpg?_nc_ht=fixture";
      const [outcome] = await syncAll(
        db,
        { fetch: fixtureFetch({ missingImages: [missing] }) },
        SECRET,
        NOW,
      );
      expect(outcome).toMatchObject({ added: 4, skipped: 1 });
      const [next] = await syncAll(db, app, SECRET, LATER);
      expect(next).toMatchObject({ added: 1, skipped: 0 });
    });
  });

  it("notes a passing problem without disconnecting", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await connect(db, w);
      const [outcome] = await syncAll(
        db,
        { fetch: fixtureFetch({ unreachable: true }) },
        SECRET,
        NOW,
      );
      expect(outcome).toMatchObject({
        error: "Instagram could not be reached",
      });
      expect(await instagramAccount(db, w.leagueId)).toMatchObject({
        status: "active",
        lastError: "Instagram could not be reached",
      });
    });
  });
});

describe("a refused token", () => {
  it("needs reconnecting, keeps the photos and tells each admin once", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await connect(db, w);
      await syncAll(db, app, SECRET, NOW);
      await saveConnection(db, {
        leagueId: w.leagueId,
        profile: {
          externalId: "17841400000000001",
          username: "league.example",
        },
        token: { accessToken: EXPIRED_FIXTURE_TOKEN, expiresAt: NOW },
        secret: SECRET,
        actorId: w.adminId,
        now: NOW,
      });
      const [outcome] = await refreshAll(db, app, SECRET, LATER);
      expect(outcome).toMatchObject({ refreshed: false });
      expect(await instagramAccount(db, w.leagueId)).toMatchObject({
        status: "needs_reconnect",
      });
      expect(await needsReconnect(db, w.leagueId)).toEqual({
        username: "league.example",
      });
      expect(await adminPosts(db, w.leagueId)).toHaveLength(5);
      // The jobs leave it alone until an admin reconnects.
      expect(await syncAll(db, app, SECRET, LATER)).toEqual([]);
      const notices = await db
        .select({ userId: message.userId, template: message.template })
        .from(message)
        .where(eq(message.template, "instagram_reconnect"));
      expect(notices).toEqual(
        expect.arrayContaining([
          { userId: w.adminId, template: "instagram_reconnect" },
        ]),
      );
      const mine = notices.filter((n) => n.userId === w.adminId);
      expect(mine).toHaveLength(1);
      expect(id).toBeTruthy();
    });
  });

  it("treats a token that no longer decrypts as needing reconnecting", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await connect(db, w);
      expect(await connectedAccounts(db, `${SECRET}-rotated`, NOW)).toEqual([]);
      expect((await instagramAccount(db, w.leagueId))?.status).toBe(
        "needs_reconnect",
      );
    });
  });
});

describe("refreshAll", () => {
  it("extends a token at least a day old and leaves a newer one", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await connect(db, w);
      expect(await refreshAll(db, app, SECRET, NOW)).toEqual([
        { accountId: id, refreshed: false },
      ]);
      expect(await refreshAll(db, app, SECRET, LATER)).toEqual([
        { accountId: id, refreshed: true },
      ]);
      const [row] = await db
        .select()
        .from(socialAccount)
        .where(eq(socialAccount.id, id));
      expect(
        decryptToken(row!.tokenCiphertext!, SECRET, `social_account:${id}`),
      ).toBe("fixture-refreshed-token");
      expect(row?.tokenRefreshedAt).toEqual(LATER);
    });
  });
});

describe("curatePost", () => {
  async function synced(db: Db) {
    const w = await world(db);
    await connect(db, w);
    await syncAll(db, app, SECRET, NOW);
    // One at a time: the test's transaction has a single connection.
    const ids: SocialPostId[] = [];
    for (const e of [
      "18000000000000001",
      "18000000000000003",
      "18000000000000004",
    ])
      ids.push(await postId(db, e));
    const curate = (
      id: SocialPostId,
      change: Parameters<typeof curatePost>[1]["change"],
    ) =>
      curatePost(db, {
        leagueId: w.leagueId,
        postId: id,
        change,
        actorId: w.adminId,
      });
    return { w, ids, curate };
  }

  it("shows nothing publicly until featured, unless showing the newest", async () => {
    await inRolledBackDb(async (db) => {
      const { w, ids, curate } = await synced(db);
      expect((await homePhotos(db, w.leagueId)).photos).toEqual([]);
      await curate(ids[1]!, { kind: "feature", on: true });
      const home = await homePhotos(db, w.leagueId);
      expect(home.photos.map((p) => p.permalink)).toEqual([
        "https://www.instagram.com/p/FixtureTeamPhoto/",
      ]);
      await setShowNewest(db, {
        leagueId: w.leagueId,
        on: true,
        actorId: w.adminId,
      });
      expect((await homePhotos(db, w.leagueId)).photos).toHaveLength(5);
      await curate(ids[0]!, { kind: "hide", on: true });
      expect((await homePhotos(db, w.leagueId)).photos).toHaveLength(4);
    });
  });

  it("serves a photo publicly only while it is shown", async () => {
    await inRolledBackDb(async (db) => {
      const { w, ids, curate } = await synced(db);
      const post = (await adminPosts(db, w.leagueId)).find(
        (p) => p.id === ids[0],
      )!;
      expect((await storedImage(db, post.imageId!))?.shown).toBe(false);
      await curate(ids[0]!, { kind: "feature", on: true });
      expect((await storedImage(db, post.imageId!))?.shown).toBe(true);
      await curate(ids[0]!, { kind: "hide", on: true });
      expect((await storedImage(db, post.imageId!))?.shown).toBe(false);
    });
  });

  it("hiding unfeatures and drops the cover; featuring unhides", async () => {
    await inRolledBackDb(async (db) => {
      const { w, ids, curate } = await synced(db);
      await curate(ids[0]!, { kind: "cover", cover: "home" });
      await curate(ids[0]!, { kind: "hide", on: true });
      let [post] = (await adminPosts(db, w.leagueId)).filter(
        (p) => p.id === ids[0],
      );
      expect(post).toMatchObject({
        hidden: true,
        featured: false,
        cover: null,
      });
      await curate(ids[0]!, { kind: "feature", on: true });
      [post] = (await adminPosts(db, w.leagueId)).filter(
        (p) => p.id === ids[0],
      );
      expect(post).toMatchObject({ hidden: false, featured: true });
    });
  });

  it("keeps one cover per page, and a team cover needs a team", async () => {
    await inRolledBackDb(async (db) => {
      const { w, ids, curate } = await synced(db);
      await curate(ids[0]!, { kind: "cover", cover: "home" });
      await curate(ids[1]!, { kind: "cover", cover: "home" });
      const home = await homePhotos(db, w.leagueId);
      expect(home.cover?.permalink).toBe(
        "https://www.instagram.com/p/FixtureTeamPhoto/",
      );
      // The old cover stays featured, in the strip.
      expect(home.photos.map((p) => p.permalink)).toContain(
        "https://www.instagram.com/p/FixtureChampionship/",
      );

      expect(await curate(ids[2]!, { kind: "cover", cover: "team" })).toEqual({
        ok: false,
        error: "cover_needs_team",
      });
      await curate(ids[2]!, { kind: "team", teamId: w.sun });
      await curate(ids[2]!, { kind: "cover", cover: "team" });
      await curate(ids[0]!, { kind: "team", teamId: w.sun });
      await curate(ids[0]!, { kind: "cover", cover: "team" });
      const sun = await teamPhotos(db, w.sun);
      expect(sun.cover?.permalink).toBe(
        "https://www.instagram.com/p/FixtureChampionship/",
      );
      expect(sun.photos.map((p) => p.permalink)).toEqual([
        "https://www.instagram.com/p/FixtureAfterParty/",
      ]);
      // Moving a cover to another team drops it.
      await curate(ids[0]!, { kind: "team", teamId: w.big });
      expect((await teamPhotos(db, w.sun)).cover).toBeNull();
      expect((await teamPhotos(db, w.big)).cover).toBeNull();
    });
  });

  it("refuses another league's team or post, and long alt text", async () => {
    await inRolledBackDb(async (db) => {
      const { ids, curate } = await synced(db);
      const other = await world(db);
      expect(
        await curate(ids[0]!, { kind: "team", teamId: other.sun }),
      ).toEqual({ ok: false, error: "unknown_team" });
      expect(
        await curatePost(db, {
          leagueId: other.leagueId,
          postId: ids[0]!,
          change: { kind: "feature", on: true },
          actorId: other.adminId,
        }),
      ).toEqual({ ok: false, error: "not_found" });
      expect(
        await curate(ids[0]!, { kind: "alt", text: "x".repeat(301) }),
      ).toEqual({ ok: false, error: "alt_too_long" });
      expect(
        await curate(ids[0]!, { kind: "alt", text: "  Team photo  " }),
      ).toEqual({ ok: true, value: undefined });
      const [row] = await db
        .select({ altText: socialPost.altText })
        .from(socialPost)
        .where(eq(socialPost.id, ids[0]!));
      expect(row?.altText).toBe("Team photo");
    });
  });

  it("records every change in the audit log with before and after", async () => {
    await inRolledBackDb(async (db) => {
      const { ids, curate } = await synced(db);
      await curate(ids[0]!, { kind: "feature", on: true });
      const [entry] = await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entityId, ids[0]!),
            eq(auditLog.action, "instagram.post_feature"),
          ),
        );
      expect(entry?.before).toMatchObject({ featured: false });
      expect(entry?.after).toMatchObject({ featured: true });
    });
  });
});

describe("storage limits", () => {
  /** A page of Instagram media, `count` posts from minute `from` on. */
  const page = (from: number, count: number) => ({
    data: Array.from({ length: count }, (_, i) => {
      const n = from + i;
      return {
        id: `limit-${n}`,
        caption: `Post ${n}`,
        media_type: "IMAGE",
        media_url: `https://scontent.cdninstagram.com/limit-${n}.jpg`,
        permalink: `https://www.instagram.com/p/Limit${n}/`,
        timestamp: new Date(Date.UTC(2026, 8, 1) + n * 60_000)
          .toISOString()
          .replace(/\.\d{3}Z$/, "+0000"),
      };
    }),
  });

  it("keeps the 30 newest posts plus curated ones, and deletes the rest with their photos", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await connect(db, w);
      // 25 older posts, two of them curated, then 25 newer ones.
      await syncAll(
        db,
        { fetch: fixtureFetch({ media: page(0, 25) }) },
        SECRET,
        NOW,
      );
      const featured = await postId(db, "limit-0");
      const cover = await postId(db, "limit-1");
      for (const [id, change] of [
        [featured, { kind: "feature", on: true }],
        [cover, { kind: "cover", cover: "home" }],
      ] as const)
        await curatePost(db, {
          leagueId: w.leagueId,
          postId: id,
          change,
          actorId: w.adminId,
        });
      const [outcome] = await syncAll(
        db,
        { fetch: fixtureFetch({ media: page(25, 25) }) },
        SECRET,
        LATER,
      );
      expect(outcome).toMatchObject({ added: 25, removed: 18, full: false });

      const posts = await adminPosts(db, w.leagueId);
      expect(posts).toHaveLength(KEEP_RECENT + 2);
      const ids = new Set(posts.map((p) => p.permalink));
      expect(ids.has("https://www.instagram.com/p/Limit0/")).toBe(true);
      expect(ids.has("https://www.instagram.com/p/Limit1/")).toBe(true);
      expect(ids.has("https://www.instagram.com/p/Limit19/")).toBe(false);
      expect(ids.has("https://www.instagram.com/p/Limit20/")).toBe(true);
      // Every remaining post has its photo, and no photo is left without one.
      expect(posts.every((p) => p.imageId)).toBe(true);
      const images = await db
        .select({ id: socialImage.id })
        .from(socialImage)
        .innerJoin(socialPost, eq(socialImage.postId, socialPost.id))
        .innerJoin(socialAccount, eq(socialPost.accountId, socialAccount.id))
        .where(eq(socialAccount.leagueId, w.leagueId));
      expect(images).toHaveLength(KEEP_RECENT + 2);
    });
  });

  it("never stores more than the cap, copies the newest that fit, and tells admins once", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const accountId = await connect(db, w);
      const size = 1000;
      const cap = (await storedImageBytes(db)) + 3 * size;
      const posts: RecentPost[] = Array.from({ length: 5 }, (_, i) => ({
        externalId: `cap-${i}`,
        caption: null,
        mediaType: "image",
        imageUrl: `https://scontent.cdninstagram.com/cap-${i}.jpg`,
        permalink: `https://www.instagram.com/p/Cap${i}/`,
        takenAt: new Date(Date.UTC(2026, 9, 1, i)),
      }));
      const images = new Map(
        posts.map((p) => [
          p.externalId,
          { contentType: "image/png", bytes: Buffer.alloc(size, 7) },
        ]),
      );
      const sync = (now: Date) =>
        applySync(db, {
          accountId,
          fetched: { posts, complete: true },
          images,
          now,
          capBytes: cap,
        });

      expect(await sync(NOW)).toMatchObject({ added: 3, full: true });
      expect(await storedImageBytes(db)).toBeLessThanOrEqual(cap);
      const kept = (await adminPosts(db, w.leagueId)).map((p) => p.permalink);
      expect(kept).toEqual([
        "https://www.instagram.com/p/Cap4/",
        "https://www.instagram.com/p/Cap3/",
        "https://www.instagram.com/p/Cap2/",
      ]);
      expect((await instagramAccount(db, w.leagueId))?.lastError).toBe(
        STORAGE_FULL_MESSAGE,
      );

      // Still full on the next run: nothing more is stored, nobody is told twice.
      expect(await sync(LATER)).toMatchObject({ added: 0, full: true });
      expect(await storedImageBytes(db)).toBeLessThanOrEqual(cap);
      const notices = await db
        .select({ userId: message.userId })
        .from(message)
        .where(
          and(
            eq(message.template, "instagram_storage_full"),
            eq(message.userId, w.adminId),
          ),
        );
      expect(notices).toHaveLength(1);
    });
  });
});

describe("disconnect", () => {
  it("deletes the token and keeps the photos when asked", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await connect(db, w);
      await syncAll(db, app, SECRET, NOW);
      await curatePost(db, {
        leagueId: w.leagueId,
        postId: await postId(db, "18000000000000001"),
        change: { kind: "feature", on: true },
        actorId: w.adminId,
      });
      await disconnect(db, {
        leagueId: w.leagueId,
        keepPhotos: true,
        actorId: w.adminId,
      });
      const [row] = await db
        .select()
        .from(socialAccount)
        .where(eq(socialAccount.leagueId, w.leagueId));
      expect(row).toMatchObject({
        status: "disconnected",
        tokenCiphertext: null,
      });
      expect((await homePhotos(db, w.leagueId)).photos).toHaveLength(1);
      // The sync stops.
      expect(await syncAll(db, app, SECRET, LATER)).toEqual([]);
    });
  });

  it("removes every synced post and photo when asked", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await connect(db, w);
      await syncAll(db, app, SECRET, NOW);
      await disconnect(db, {
        leagueId: w.leagueId,
        keepPhotos: false,
        actorId: w.adminId,
      });
      expect(await adminPosts(db, w.leagueId)).toEqual([]);
    });
  });
});

describe("the recorded fixture", () => {
  it("parses as the client expects", async () => {
    const result = await recentPosts(app, "fixture-long-lived-token");
    expect(result.ok).toBe(true);
  });
});
