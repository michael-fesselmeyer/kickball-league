import { randomBytes } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { can } from "@/domain/authz/permissions";
import type { FriendFields } from "@/domain/friends/friend-form";
import {
  MAX_STORED_LOGO_BYTES,
  MAX_TOTAL_LOGO_BYTES,
} from "@/domain/friends/logo";
import type { FriendLeagueId } from "@/domain/ids";
import { auditLog } from "../schema/audit";
import { friendLeague, friendLogo } from "../schema/friends";
import { leagueWorld } from "../test/league-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  createFriendLeague,
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
import { loadSubject } from "./subject";

afterAll(closePool);

const softball: FriendFields = {
  name: "Test Slow-Pitch Social",
  activity: "softball",
  area: "McCarren Park",
  description: "Saturday morning softball.",
  url: "https://slow-pitch.example.test/",
  linksBack: true,
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
      .orderBy(auditLog.occurredAt)
  ).map((r) => r.action);

describe("friends directory", () => {
  it("lets only admins manage the directory", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const allowed = async (userId: typeof w.admin) =>
        can(await loadSubject(db, userId), "friends.manage");
      expect(await allowed(w.admin)).toBe(true);
      expect(await allowed(w.captain)).toBe(false);
      expect(await allowed(w.teammate)).toBe(false);
      expect(await allowed(w.agent)).toBe(false);
      expect(can(await loadSubject(db, null), "friends.manage")).toBe(false);
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
      expect(await auditActions(db, id)).toEqual([
        "friend_league.create",
        "friend_league.update",
        "friend_league.remove",
      ]);
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
      expect(await auditActions(db, id)).toEqual([
        "friend_league.create",
        "friend_league.logo_set",
        "friend_league.logo_set",
        "friend_league.logo_remove",
      ]);
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
    });
  });
});
