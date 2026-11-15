import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { UserId } from "@/domain/ids";
import { gameAttendance } from "../schema/attendance";
import { auditLog } from "../schema/audit";
import { season } from "../schema/season";
import { subClaim, subRequest } from "../schema/subs";
import { waiver, waiverSignature } from "../schema/waiver";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { deleteAccount, personalData } from "./account";
import {
  attendanceGame,
  checkedInFor,
  checkInByScan,
  gameAttendanceList,
  saveAttendance,
  seasonAttendance,
  teamAttendance,
} from "./attendance";
import type { Db } from "./schedule";

afterAll(closePool);

// Game day: Tuesday Sep 15, 2026, 7 to 8 PM in New York.
const KICKOFF_END = new Date("2026-09-16T00:00:00Z");
const DURING = new Date("2026-09-15T23:30:00Z");
const NEXT_WEEK_END = new Date("2026-09-23T00:00:00Z");
const BODY_SHA = "0".repeat(64);

/**
 * Aces vs Bees, with a sub the Aces approved and one still pending, and a
 * season waiver only some players signed.
 */
async function world(db: Db) {
  const w = await messagingWorld(db);
  const ref = await w.person("ref");
  const sub = await w.person("sub");
  const hopeful = await w.person("hopeful");
  const { gameId } = await w.gameEnding(KICKOFF_END, ref.userId);
  const [request] = await db
    .insert(subRequest)
    .values({
      gameId,
      teamSeasonId: w.aces.id,
      requestedBy: w.aces.captain.userId,
      needed: 2,
      closesAt: KICKOFF_END,
    })
    .returning({ id: subRequest.id });
  await db.insert(subClaim).values([
    { subRequestId: request!.id, userId: sub.userId, status: "approved" },
    { subRequestId: request!.id, userId: hopeful.userId, status: "pending" },
  ]);
  const [w1] = await db
    .insert(waiver)
    .values({
      leagueId: w.leagueId,
      version: 1,
      title: "Waiver",
      bodyMd: "Play safe.",
      bodySha256: BODY_SHA,
    })
    .returning({ id: waiver.id });
  await db
    .update(season)
    .set({ waiverId: w1!.id, playoffMinGames: 2 })
    .where(eq(season.id, w.season.id));
  for (const p of [w.aces.captain, w.bees.captain])
    await db.insert(waiverSignature).values({
      waiverId: w1!.id,
      userId: p.userId,
      seasonId: w.season.id,
      signedName: "Pat Example",
      bodySha256: BODY_SHA,
    });
  const g = await attendanceGame(db, gameId);
  if (!g) throw new Error("no game");
  return { ...w, ref, sub, hopeful, gameId, g };
}

const marks = (db: Db) =>
  db.select().from(auditLog).where(eq(auditLog.action, "attendance.mark"));

describe("checking in by scan", () => {
  it("records a rostered player once, for their team", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const me = w.aces.players[0]!.userId;
      const first = await checkInByScan(db, {
        game: w.g,
        userId: me,
        now: DURING,
      });
      expect(first).toEqual({
        ok: true,
        value: { first: true, teamSeasonId: w.aces.id },
      });
      const again = await checkInByScan(db, {
        game: w.g,
        userId: me,
        now: DURING,
      });
      expect(again.ok && again.value.first).toBe(false);
      expect(await checkedInFor(db, w.gameId, me)).toEqual({
        teamSeasonId: w.aces.id,
      });
      const [row] = await db
        .select()
        .from(gameAttendance)
        .where(eq(gameAttendance.userId, me));
      expect(row).toMatchObject({ method: "scan", recordedBy: me });
    });
  });

  it("counts an approved sub for the team that asked, not a pending one", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const sub = await checkInByScan(db, {
        game: w.g,
        userId: w.sub.userId,
        now: DURING,
      });
      expect(sub.ok && sub.value.teamSeasonId).toBe(w.aces.id);
      expect(
        await checkInByScan(db, {
          game: w.g,
          userId: w.hopeful.userId,
          now: DURING,
        }),
      ).toEqual({ ok: false, error: "not_playing" });
    });
  });

  it("refuses someone on neither team, and the ref", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      for (const userId of [w.freeAgent.userId, w.ref.userId])
        expect(
          await checkInByScan(db, { game: w.g, userId, now: DURING }),
        ).toEqual({ ok: false, error: "not_playing" });
      expect(await db.select().from(gameAttendance)).toHaveLength(0);
    });
  });
});

describe("the game's check-in list", () => {
  it("lists both rosters and approved subs with check-ins and unsigned waivers", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await checkInByScan(db, {
        game: w.g,
        userId: w.aces.captain.userId,
        now: DURING,
      });
      await checkInByScan(db, { game: w.g, userId: w.sub.userId, now: DURING });
      const list = await gameAttendanceList(db, w.g);
      const ids = (team: string) =>
        list.filter((p) => p.teamSeasonId === team).map((p) => p.userId);
      expect(ids(w.aces.id).sort()).toEqual(
        [w.aces.captain, ...w.aces.players, w.sub].map((p) => p.userId).sort(),
      );
      expect(ids(w.bees.id)).toHaveLength(3);
      expect(list.map((p) => p.userId)).not.toContain(w.hopeful.userId);
      const by = (id: UserId) => list.find((p) => p.userId === id)!;
      expect(by(w.aces.captain.userId)).toMatchObject({
        checkedIn: { method: "scan" },
        waiverSigned: true,
      });
      // Checked in without the season's waiver: the ref sees the flag.
      expect(by(w.sub.userId)).toMatchObject({
        sub: true,
        checkedIn: { method: "scan" },
        waiverSigned: false,
      });
      expect(by(w.aces.players[0]!.userId)).toMatchObject({
        checkedIn: null,
        waiverSigned: false,
      });
    });
  });
});

describe("ticking players in and out", () => {
  it("adds and removes, and audits who changed what", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const me = w.aces.players[0]!.userId;
      await checkInByScan(db, { game: w.g, userId: me, now: DURING });
      const people = await gameAttendanceList(db, w.g);
      const saved = await saveAttendance(db, {
        gameId: w.gameId,
        people,
        add: [w.bees.captain.userId, w.sub.userId],
        remove: [me],
        actorId: w.ref.userId,
        now: DURING,
      });
      expect(saved).toEqual({ added: 2, removed: 1 });
      const rows = await db
        .select()
        .from(gameAttendance)
        .where(eq(gameAttendance.gameId, w.gameId));
      expect(rows.map((r) => r.userId).sort()).toEqual(
        [w.bees.captain.userId, w.sub.userId].sort(),
      );
      expect(rows.every((r) => r.method === "marked")).toBe(true);
      expect(rows.find((r) => r.userId === w.sub.userId)?.teamSeasonId).toBe(
        w.aces.id,
      );
      const [audit] = await marks(db);
      expect(audit).toMatchObject({
        actorId: w.ref.userId,
        entityType: "game",
        entityId: w.gameId,
        after: {
          added: [w.bees.captain.userId, w.sub.userId].sort(),
          removed: [me],
        },
      });
    });
  });

  it("ignores anyone not in the game and writes nothing when nothing changes", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const people = await gameAttendanceList(db, w.g);
      const saved = await saveAttendance(db, {
        gameId: w.gameId,
        people,
        add: [w.freeAgent.userId],
        remove: [],
        actorId: w.aces.captain.userId,
        now: DURING,
      });
      expect(saved).toEqual({ added: 0, removed: 0 });
      expect(await db.select().from(gameAttendance)).toHaveLength(0);
      expect(await marks(db)).toHaveLength(0);
    });
  });
});

describe("games played", () => {
  it("counts games for any team toward the season's minimum", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const ace = w.aces.players[0]!;
      // An Aces player also subs for the Bees the next week.
      const { gameId: second } = await w.gameEnding(NEXT_WEEK_END);
      const g2 = await attendanceGame(db, second);
      await checkInByScan(db, { game: w.g, userId: ace.userId, now: DURING });
      await saveAttendance(db, {
        gameId: second,
        people: [
          { userId: ace.userId, teamSeasonId: w.bees.id, checkedIn: null },
        ],
        add: [ace.userId],
        remove: [],
        actorId: w.bees.captain.userId,
        now: NEXT_WEEK_END,
      });
      expect(g2).not.toBeNull();

      const aces = await teamAttendance(db, {
        teamSeasonId: w.aces.id,
        seasonId: w.season.id,
      });
      expect(aces.playoffMinGames).toBe(2);
      expect(aces.games.map((g) => g.id)).toEqual([w.gameId, second]);
      expect(aces.players.find((p) => p.userId === ace.userId)).toMatchObject({
        gameIds: [w.gameId],
        played: 2,
      });

      const bees = await teamAttendance(db, {
        teamSeasonId: w.bees.id,
        seasonId: w.season.id,
      });
      expect(bees.subs).toEqual([
        { userId: ace.userId, name: expect.any(String), gameIds: [second] },
      ]);

      const all = await seasonAttendance(db, w.season.id);
      const acesRow = all.teams.find((t) => t.teamSeasonId === w.aces.id);
      expect(
        acesRow?.players.find((p) => p.userId === ace.userId)?.played,
      ).toBe(2);
      expect(
        acesRow?.players.find((p) => p.userId === w.aces.captain.userId)
          ?.played,
      ).toBe(0);
    });
  });
});

describe("a player's own data", () => {
  it("lists their check-ins in their export and deletes them with the account", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const me = w.aces.players[0]!.userId;
      await checkInByScan(db, { game: w.g, userId: me, now: DURING });
      const data = await personalData(db, me, DURING);
      expect(data?.gamesPlayed).toEqual([
        expect.objectContaining({ gameId: w.gameId, method: "scan" }),
      ]);
      expect((await deleteAccount(db, me, DURING)).ok).toBe(true);
      expect(await checkedInFor(db, w.gameId, me)).toBeNull();
    });
  });
});
