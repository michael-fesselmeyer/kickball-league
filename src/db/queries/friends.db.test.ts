import { randomBytes } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { can } from "@/domain/authz/permissions";
import type { FriendFields } from "@/domain/friends/friend-form";
import {
  MAX_STORED_LOGO_BYTES,
  MAX_TOTAL_LOGO_BYTES,
} from "@/domain/friends/logo";
import { type FriendLeagueId, parseId } from "@/domain/ids";
import { auditLog } from "../schema/audit";
import { friendClick, friendLeague, friendLogo } from "../schema/friends";
import { leagueWorld } from "../test/league-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  countFriendClick,
  createFriendLeague,
  featuredFriends,
  friendClickCounts,
  friendDirectory,
  friendLeagueById,
  removeFriendLeague,
  removeFriendLogo,
  setFriendLogo,
  type StoredLogo,
  storedFriendLogo,
  storedLogoBytes,
  updateFriendLeague,
} from "./friends";
import type { Db } from "./schedule";
import { subjectIn } from "../test/leagues";

afterAll(closePool);

const softball: FriendFields = {
  name: "Test Slow-Pitch Social",
  activity: "softball",
  area: "McCarren Park",
  description: "Saturday morning softball.",
  url: "https://slow-pitch.example.test/",
  linksBack: true,
  runByPlayer: false,
  featured: false,
};

const sketchClub: FriendFields = {
  name: "Test Sketch Club",
  activity: "other",
  area: null,
  description: null,
  url: "https://sketch-club.example.test/",
  linksBack: false,
  runByPlayer: true,
  featured: true,
};

const logoOf = (size: number): StoredLogo => ({
  contentType: "image/webp",
  bytes: randomBytes(size),
  width: 96,
  height: 96,
  sha256: "0".repeat(64),
});

/** The constraint a write broke, run in a savepoint so the test carries on. */
async function violated(db: Db, write: (db: Db) => Promise<unknown>) {
  try {
    await db.transaction(async (sp) => {
      await write(sp);
    });
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    for (const e of [error, cause])
      if (
        e instanceof Error &&
        "constraint" in e &&
        typeof e.constraint === "string"
      )
        return e.constraint;
    throw error;
  }
  return null;
}

async function setUp(db: Db) {
  const w = await leagueWorld(db);
  const created = await createFriendLeague(db, {
    leagueId: w.leagueId,
    fields: softball,
    actorId: w.admin,
  });
  if (!created.ok) throw new Error(created.error);
  return { w, id: created.value };
}

/**
 * The entry's audit actions, sorted. Every row in a test's transaction has
 * the same occurred_at, so the database can return them in any order; the
 * tests compare them as a sorted list (repeats included) instead.
 */
const auditActions = async (db: Db, id: FriendLeagueId) =>
  (
    await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityId, id),
          like(auditLog.action, "friend_league.%"),
        ),
      )
  )
    .map((r) => r.action)
    .sort();

const sorted = (actions: string[]) => [...actions].sort();

describe("friends directory", () => {
  it("lets only admins manage the directory", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const allowed = async (userId: typeof w.admin) =>
        can(await subjectIn(db, userId), "friends.manage");
      expect(await allowed(w.admin)).toBe(true);
      expect(await allowed(w.captain)).toBe(false);
      expect(await allowed(w.teammate)).toBe(false);
      expect(await allowed(w.agent)).toBe(false);
      expect(can(await subjectIn(db, null), "friends.manage")).toBe(false);
    });
  });

  it("adds, changes and removes an entry, auditing each change", async () => {
    await inRolledBackDb(async (db) => {
      const { w, id } = await setUp(db);
      expect(await friendDirectory(db, w.leagueId)).toMatchObject([
        { id, ...softball, logo: null },
      ]);

      const changed = { ...softball, linksBack: false, area: null };
      expect(
        await updateFriendLeague(db, {
          leagueId: w.leagueId,
          id,
          fields: changed,
          actorId: w.admin,
        }),
      ).toEqual({ ok: true, value: null });
      expect(await friendLeagueById(db, w.leagueId, id)).toMatchObject(changed);

      expect(
        await removeFriendLeague(db, {
          leagueId: w.leagueId,
          id,
          actorId: w.admin,
        }),
      ).toEqual({ ok: true, value: null });
      expect(await friendDirectory(db, w.leagueId)).toEqual([]);
      expect(await auditActions(db, id)).toEqual(
        sorted([
          "friend_league.create",
          "friend_league.update",
          "friend_league.remove",
        ]),
      );
    });
  });

  it("refuses a second entry with the same name, whatever its case", async () => {
    await inRolledBackDb(async (db) => {
      const { w } = await setUp(db);
      const again = await createFriendLeague(db, {
        leagueId: w.leagueId,
        fields: { ...softball, name: softball.name.toUpperCase() },
        actorId: w.admin,
      });
      expect(again).toEqual({ ok: false, error: "name_taken" });
    });
  });

  it("never reaches another league's entry", async () => {
    await inRolledBackDb(async (db) => {
      const { id } = await setUp(db);
      const other = await leagueWorld(db);
      const args = { leagueId: other.leagueId, id, actorId: other.admin };
      expect(await friendLeagueById(db, other.leagueId, id)).toBeNull();
      expect(
        await updateFriendLeague(db, { ...args, fields: softball }),
      ).toEqual({ ok: false, error: "not_found" });
      expect(await removeFriendLeague(db, args)).toEqual({
        ok: false,
        error: "not_found",
      });
      expect(await setFriendLogo(db, { ...args, logo: logoOf(1000) })).toEqual({
        ok: false,
        error: "not_found",
      });
    });
  });

  it("replaces a logo with a new address, and removes it", async () => {
    await inRolledBackDb(async (db) => {
      const { w, id } = await setUp(db);
      const args = { leagueId: w.leagueId, id, actorId: w.admin };
      const first = await setFriendLogo(db, { ...args, logo: logoOf(2000) });
      const second = await setFriendLogo(db, { ...args, logo: logoOf(3000) });
      if (!first.ok || !second.ok) throw new Error("logo not saved");
      expect(second.value).not.toBe(first.value);
      expect(await storedFriendLogo(db, first.value)).toBeNull();
      expect((await storedFriendLogo(db, second.value))?.bytes).toHaveLength(
        3000,
      );
      expect((await friendLeagueById(db, w.leagueId, id))?.logo).toEqual({
        id: second.value,
        width: 96,
        height: 96,
      });

      expect(await removeFriendLogo(db, args)).toEqual({
        ok: true,
        value: null,
      });
      expect(await storedFriendLogo(db, second.value)).toBeNull();
      expect(await auditActions(db, id)).toEqual(
        sorted([
          "friend_league.create",
          "friend_league.logo_set",
          "friend_league.logo_set",
          "friend_league.logo_remove",
        ]),
      );
    });
  });

  it("keeps all logos together under the cap", async () => {
    await inRolledBackDb(async (db) => {
      const { w, id } = await setUp(db);
      // Fill the store with full-size logos until less than 30 KB is left.
      let filler: FriendLeagueId | null = null;
      for (let i = 0; ; i++) {
        const left = MAX_TOTAL_LOGO_BYTES - (await storedLogoBytes(db));
        if (left < 30 * 1024) break;
        const [row] = await db
          .insert(friendLeague)
          .values({
            leagueId: w.leagueId,
            name: `Filler league ${i}`,
            activity: "other",
            url: `https://filler-${i}.example.test/`,
          })
          .returning({ id: friendLeague.id });
        if (!row) throw new Error("filler not created");
        const size = Math.min(MAX_STORED_LOGO_BYTES, left - 10 * 1024);
        const { sha256, ...logo } = logoOf(size);
        await db.insert(friendLogo).values({
          friendLeagueId: row.id,
          ...logo,
          byteSize: size,
          sha256,
        });
        filler = row.id;
      }
      if (!filler) throw new Error("no filler");

      const args = { leagueId: w.leagueId, actorId: w.admin };
      expect(
        await setFriendLogo(db, { ...args, id, logo: logoOf(30 * 1024) }),
      ).toEqual({ ok: false, error: "logo_store_full" });
      expect((await friendLeagueById(db, w.leagueId, id))?.logo).toBeNull();
      // Replacing a logo counts the one it replaces as freed.
      const replaced = await setFriendLogo(db, {
        ...args,
        id: filler,
        logo: logoOf(30 * 1024),
      });
      expect(replaced.ok).toBe(true);
      expect(await storedLogoBytes(db)).toBeLessThanOrEqual(
        MAX_TOTAL_LOGO_BYTES,
      );
    });
  });

  it("holds the database to the same rules as the form", async () => {
    await inRolledBackDb(async (db) => {
      const { w, id } = await setUp(db);
      const row = {
        leagueId: w.leagueId,
        name: "Another league",
        activity: "pool" as const,
        url: "https://pool.example.test/",
      };
      expect(
        await violated(db, (sp) =>
          sp
            .insert(friendLeague)
            .values({ ...row, url: "http://pool.example.test/" }),
        ),
      ).toBe("friend_league_url_https");
      expect(
        await violated(db, (sp) =>
          sp.insert(friendLeague).values({ ...row, name: "x".repeat(81) }),
        ),
      ).toBe("friend_league_name_length");
      const big = logoOf(MAX_STORED_LOGO_BYTES + 1);
      expect(
        await violated(db, (sp) =>
          sp.insert(friendLogo).values({
            friendLeagueId: id,
            ...big,
            byteSize: big.bytes.length,
          }),
        ),
      ).toBe("friend_logo_size");
      const svg = logoOf(100);
      expect(
        await violated(db, (sp) =>
          sp.insert(friendLogo).values({
            friendLeagueId: id,
            ...svg,
            contentType: "image/svg+xml",
            byteSize: 100,
          }),
        ),
      ).toBe("friend_logo_type");
      expect(
        await violated(db, (sp) =>
          sp.insert(friendLeague).values({ ...row, featured: true }),
        ),
      ).toBe("friend_league_featured_player_run");
    });
  });
});

describe("player-run clubs and clicks out", () => {
  it("shows only featured clubs on the events page", async () => {
    await inRolledBackDb(async (db) => {
      const { w } = await setUp(db);
      const club = await createFriendLeague(db, {
        leagueId: w.leagueId,
        fields: sketchClub,
        actorId: w.admin,
      });
      if (!club.ok) throw new Error(club.error);
      const featured = await featuredFriends(db, w.leagueId);
      expect(featured.map((f) => f.name)).toEqual([sketchClub.name]);
      expect(featured[0]).toMatchObject({ runByPlayer: true, featured: true });
    });
  });

  it("counts clicks per day, recent and in all, and nothing else", async () => {
    await inRolledBackDb(async (db) => {
      const { w, id } = await setUp(db);
      await countFriendClick(db, id, "2026-10-01");
      await countFriendClick(db, id, "2026-11-10");
      await countFriendClick(db, id, "2026-11-10");
      // An id that isn't in the directory counts nothing.
      const stranger = parseId<FriendLeagueId>(
        "00000000-0000-4000-8000-000000000000",
      );
      if (!stranger) throw new Error("bad test id");
      await countFriendClick(db, stranger, "2026-11-10");
      const counts = await friendClickCounts(db, w.leagueId, "2026-11-01");
      expect(counts.get(id)).toEqual({ recent: 2, total: 3 });
      expect(counts.size).toBe(1);
      const rows = await db
        .select()
        .from(friendClick)
        .where(eq(friendClick.friendLeagueId, id));
      // Only the entry, the day and the count: nothing about who clicked.
      expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
        "clicks",
        "day",
        "friendLeagueId",
      ]);
    });
  });

  it("drops an entry's counts when it leaves the directory", async () => {
    await inRolledBackDb(async (db) => {
      const { w, id } = await setUp(db);
      await countFriendClick(db, id, "2026-11-10");
      const removed = await removeFriendLeague(db, {
        leagueId: w.leagueId,
        id,
        actorId: w.admin,
      });
      expect(removed.ok).toBe(true);
      expect((await friendClickCounts(db, w.leagueId, "2026-11-01")).size).toBe(
        0,
      );
    });
  });
});
