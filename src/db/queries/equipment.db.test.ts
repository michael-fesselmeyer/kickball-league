import { and, eq, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { EquipmentKitId } from "@/domain/ids";
import { auditLog } from "../schema/audit";
import { equipmentHandoff, equipmentKit } from "../schema/equipment";
import { message } from "../schema/message";
import { profile } from "../schema/profile";
import { messagingWorld } from "../test/messaging-world";
import { grantRole } from "../test/leagues";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  answerHandoff,
  assignKit,
  cancelHandoff,
  createKit,
  dayGear,
  gearCandidates,
  handOffKit,
  kitDetail,
  leagueKits,
  myGear,
  pickUpKit,
  queueGearReminders,
  reportMissing,
  resolveReport,
  retireKit,
  returnKitHome,
  setKitHolder,
  unassignKit,
  updateKit,
} from "./equipment";
import type { Db } from "./schedule";

afterAll(closePool);

// Games kick off at 7 PM in New York: Tuesday the 17th and Thursday the 19th.
const TUESDAY_GAME_ENDS = new Date("2026-11-18T01:00:00Z");
const THURSDAY_GAME_ENDS = new Date("2026-11-20T01:00:00Z");
const SATURDAY = new Date("2026-11-14T15:00:00Z");
const MONDAY_EVENING = new Date("2026-11-16T23:00:00Z");

const KIT = {
  name: "Kit A",
  contents: ["Ball bag (4 balls)", "Bases (4)", "Pump", "First-aid kit"],
  homeLocation: "Park house locker",
};

/**
 * The messaging world with an admin, a ref for Tuesday's game, and Kit A:
 * Aces' captain brings it Tuesday, Bees' captain Thursday.
 */
async function world(db: Db) {
  const w = await messagingWorld(db);
  const admin = await w.person("gear-admin");
  await db.insert(profile).values({ userId: admin.userId });
  await grantRole(db, admin.userId, "admin", w.leagueId);
  const ref = await w.person("gear-ref");
  const tuesday = await w.gameEnding(TUESDAY_GAME_ENDS, ref.userId);
  const thursday = await w.gameEnding(THURSDAY_GAME_ENDS);
  const created = await createKit(db, {
    ...KIT,
    leagueId: w.leagueId,
    actorId: admin.userId,
  });
  if (!created.ok) throw new Error(created.error);
  const kitId = created.value;
  const jo = w.aces.captain.userId;
  const sam = w.bees.captain.userId;
  for (const [gameId, userId] of [
    [tuesday.gameId, jo],
    [thursday.gameId, sam],
  ] as const) {
    const assigned = await assignKit(db, {
      kitId,
      leagueId: w.leagueId,
      gameId,
      userId,
      actorId: admin.userId,
      now: SATURDAY,
    });
    if (!assigned.ok) throw new Error(assigned.error);
  }
  return { ...w, admin, ref, tuesday, thursday, kitId, jo, sam };
}

const audited = (db: Db) =>
  db
    .select({ action: auditLog.action, actorId: auditLog.actorId })
    .from(auditLog)
    .where(like(auditLog.action, "equipment.%"));

const holderOf = async (db: Db, kitId: EquipmentKitId) =>
  (
    await db
      .select({ holderId: equipmentKit.holderId })
      .from(equipmentKit)
      .where(eq(equipmentKit.id, kitId))
  )[0]?.holderId ?? null;

describe("league gear", () => {
  it("adds a kit at home and refuses a second kit with the same name", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const [kit] = await leagueKits(db, w.leagueId, SATURDAY);
      expect(kit).toMatchObject({
        name: "Kit A",
        holderId: null,
        pending: null,
        openReports: 0,
        next: { userId: w.jo, gameId: w.tuesday.gameId },
      });
      expect(
        await createKit(db, {
          ...KIT,
          name: "kit a",
          leagueId: w.leagueId,
          actorId: w.admin.userId,
        }),
      ).toEqual({ ok: false, error: "name_taken" });
      expect(
        await updateKit(db, {
          ...KIT,
          contents: ["Pump"],
          kitId: w.kitId,
          leagueId: w.leagueId,
          actorId: w.admin.userId,
        }),
      ).toEqual({ ok: true, value: null });
    });
  });

  it("offers the game's ref, its captains and the admins, and refuses anyone else", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const candidates = await gearCandidates(db, w.tuesday.gameId);
      expect(candidates.map((c) => [c.userId, c.role])).toEqual(
        expect.arrayContaining([
          [w.ref.userId, "ref"],
          [w.jo, "captain"],
          [w.sam, "captain"],
          [w.admin.userId, "admin"],
        ]),
      );
      expect(candidates.map((c) => c.role)).toEqual(
        [...candidates.map((c) => c.role)].sort(
          (a, b) =>
            ["ref", "captain", "admin"].indexOf(a) -
            ["ref", "captain", "admin"].indexOf(b),
        ),
      );
      const player = w.aces.players[0];
      if (!player) throw new Error("Expected a player");
      expect(
        await assignKit(db, {
          kitId: w.kitId,
          leagueId: w.leagueId,
          gameId: w.tuesday.gameId,
          userId: player.userId,
          actorId: w.admin.userId,
          now: SATURDAY,
        }),
      ).toEqual({ ok: false, error: "not_candidate" });
    });
  });

  it("goes to one game a day, and reassigning a game moves it to the new person", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const sameNight = await w.gameEnding(
        new Date(TUESDAY_GAME_ENDS.getTime() + 3_600_000),
      );
      expect(
        await assignKit(db, {
          kitId: w.kitId,
          leagueId: w.leagueId,
          gameId: sameNight.gameId,
          userId: w.jo,
          actorId: w.admin.userId,
          now: SATURDAY,
        }),
      ).toEqual({ ok: false, error: "busy_that_day" });
      const moved = await assignKit(db, {
        kitId: w.kitId,
        leagueId: w.leagueId,
        gameId: w.tuesday.gameId,
        userId: w.ref.userId,
        actorId: w.admin.userId,
        now: SATURDAY,
      });
      expect(moved.ok).toBe(true);
      const detail = await kitDetail(db, w.leagueId, w.kitId, SATURDAY);
      expect(detail?.upcoming.map((a) => a.userId)).toEqual([
        w.ref.userId,
        w.sam,
      ]);
      if (!moved.ok) return;
      await unassignKit(db, {
        assignmentId: moved.value,
        leagueId: w.leagueId,
        actorId: w.admin.userId,
      });
      expect(
        (await kitDetail(db, w.leagueId, w.kitId, SATURDAY))?.upcoming.map(
          (a) => a.userId,
        ),
      ).toEqual([w.sam]);
    });
  });

  it("walks a kit from home to Tuesday's captain, on to Thursday's, and back home", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      // Only someone bringing it to a game picks it up from home.
      expect(
        await pickUpKit(db, {
          kitId: w.kitId,
          actorId: w.ref.userId,
          now: SATURDAY,
        }),
      ).toEqual({ ok: false, error: "not_assigned" });

      expect(
        (await pickUpKit(db, { kitId: w.kitId, actorId: w.jo, now: SATURDAY }))
          .ok,
      ).toBe(true);
      expect(await holderOf(db, w.kitId)).toBe(w.jo);
      const [mine] = await myGear(db, w.jo, MONDAY_EVENING);
      expect(mine).toMatchObject({
        holding: true,
        game: { gameId: w.tuesday.gameId, place: "Park, Field 2" },
        handTo: { userId: w.sam },
        pending: null,
      });

      // After Tuesday's game, Jo hands it to Sam, who brings it Thursday.
      const wednesday = new Date("2026-11-18T15:00:00Z");
      const handed = await handOffKit(db, {
        kitId: w.kitId,
        actorId: w.jo,
        now: wednesday,
      });
      expect(handed).toEqual({
        ok: true,
        value: { toUserId: w.sam, kitName: "Kit A" },
      });
      // Not Sam's until Sam says so.
      expect(await holderOf(db, w.kitId)).toBe(w.jo);
      const [samSees] = await myGear(db, w.sam, wednesday);
      expect(samSees?.pending).toMatchObject({ direction: "in" });
      const [kit] = await leagueKits(db, w.leagueId, wednesday);
      expect(kit?.pending?.toUserId).toBe(w.sam);
      expect(
        await handOffKit(db, { kitId: w.kitId, actorId: w.jo, now: wednesday }),
      ).toEqual({ ok: false, error: "pending" });
      if (!samSees?.pending) throw new Error("Expected the handoff");
      expect(
        await answerHandoff(db, {
          handoffId: samSees.pending.id,
          actorId: w.jo,
          answer: "confirm",
          now: wednesday,
        }),
      ).toEqual({ ok: false, error: "not_receiver" });
      expect(
        (
          await answerHandoff(db, {
            handoffId: samSees.pending.id,
            actorId: w.sam,
            answer: "confirm",
            now: wednesday,
          })
        ).ok,
      ).toBe(true);
      expect(await holderOf(db, w.kitId)).toBe(w.sam);

      // After Thursday, nobody else needs it: Sam returns it home.
      const friday = new Date("2026-11-20T15:00:00Z");
      expect(
        await handOffKit(db, { kitId: w.kitId, actorId: w.sam, now: friday }),
      ).toEqual({ ok: false, error: "no_receiver" });
      expect(
        (
          await returnKitHome(db, {
            kitId: w.kitId,
            actorId: w.sam,
            now: friday,
          })
        ).ok,
      ).toBe(true);
      expect(await holderOf(db, w.kitId)).toBe(null);

      // One transaction stamps every row with the same time, so compare as a set.
      expect((await audited(db)).map((a) => a.action).sort()).toEqual([
        "equipment.assign",
        "equipment.assign",
        "equipment.hand_off",
        "equipment.handoff_confirm",
        "equipment.kit_create",
        "equipment.pick_up",
        "equipment.return_home",
      ]);
      const detail = await kitDetail(db, w.leagueId, w.kitId, friday);
      expect(detail?.history.map((h) => h.kind)).toEqual([
        "handoff_confirmed",
        "handoff_confirmed",
        "handoff_confirmed",
      ]);
    });
  });

  it("keeps the kit with the giver when the receiver says they don't have it, or the giver takes it back", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await pickUpKit(db, { kitId: w.kitId, actorId: w.jo, now: SATURDAY });
      await handOffKit(db, { kitId: w.kitId, actorId: w.jo, now: SATURDAY });
      const [first] = await myGear(db, w.sam, SATURDAY);
      if (!first?.pending) throw new Error("Expected the handoff");
      await answerHandoff(db, {
        handoffId: first.pending.id,
        actorId: w.sam,
        answer: "decline",
        now: SATURDAY,
      });
      expect(await holderOf(db, w.kitId)).toBe(w.jo);

      await handOffKit(db, { kitId: w.kitId, actorId: w.jo, now: SATURDAY });
      const [again] = await myGear(db, w.jo, SATURDAY);
      if (!again?.pending) throw new Error("Expected the handoff");
      expect(again.pending.direction).toBe("out");
      expect(
        await cancelHandoff(db, {
          handoffId: again.pending.id,
          actorId: w.sam,
          now: SATURDAY,
        }),
      ).toEqual({ ok: false, error: "not_giver" });
      expect(
        (
          await cancelHandoff(db, {
            handoffId: again.pending.id,
            actorId: w.jo,
            now: SATURDAY,
          })
        ).ok,
      ).toBe(true);
      expect(await holderOf(db, w.kitId)).toBe(w.jo);
      const statuses = await db
        .select({ status: equipmentHandoff.status })
        .from(equipmentHandoff)
        .where(eq(equipmentHandoff.kitId, w.kitId))
        .orderBy(equipmentHandoff.createdAt, equipmentHandoff.id);
      expect(statuses.map((s) => s.status).sort()).toEqual([
        "cancelled",
        "confirmed",
        "declined",
      ]);
    });
  });

  it("lets an admin correct where a kit is, cancelling a handoff that waits", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await pickUpKit(db, { kitId: w.kitId, actorId: w.jo, now: SATURDAY });
      await handOffKit(db, { kitId: w.kitId, actorId: w.jo, now: SATURDAY });
      expect(
        await setKitHolder(db, {
          kitId: w.kitId,
          leagueId: w.leagueId,
          holderId: w.sam,
          actorId: w.admin.userId,
          now: SATURDAY,
        }),
      ).toEqual({ ok: true, value: null });
      expect(await holderOf(db, w.kitId)).toBe(w.sam);
      const [kit] = await leagueKits(db, w.leagueId, SATURDAY);
      expect(kit?.pending).toBe(null);
      expect(await audited(db)).toContainEqual({
        action: "equipment.set_holder",
        actorId: w.admin.userId,
      });
    });
  });

  it("takes missing-items reports from people with the kit, and admins sort them", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const outsider = w.aces.players[0];
      if (!outsider) throw new Error("Expected a player");
      const report = {
        kitId: w.kitId,
        missing: ["Pump"],
        note: "Needle snapped",
        admin: false,
        now: SATURDAY,
      };
      expect(
        await reportMissing(db, { ...report, actorId: outsider.userId }),
      ).toEqual({ ok: false, error: "not_allowed" });
      const filed = await reportMissing(db, { ...report, actorId: w.sam });
      expect(filed.ok).toBe(true);
      expect((await leagueKits(db, w.leagueId, SATURDAY))[0]?.openReports).toBe(
        1,
      );
      if (!filed.ok) return;
      expect(
        (
          await resolveReport(db, {
            reportId: filed.value,
            leagueId: w.leagueId,
            actorId: w.admin.userId,
            now: SATURDAY,
          })
        ).ok,
      ).toBe(true);
      const detail = await kitDetail(db, w.leagueId, w.kitId, SATURDAY);
      expect(detail?.reports).toEqual([]);
      expect(detail?.history.map((h) => h.kind)).toEqual(
        expect.arrayContaining(["report", "report_resolved"]),
      );
    });
  });

  it("shows the day's kits on the command center", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await pickUpKit(db, { kitId: w.kitId, actorId: w.jo, now: SATURDAY });
      const rows = await dayGear(db, w.leagueId, "2026-11-17", SATURDAY);
      expect(rows).toEqual([
        expect.objectContaining({
          kitName: "Kit A",
          gameId: w.tuesday.gameId,
          place: "Park, Field 2",
          bringBy: new Date("2026-11-17T23:30:00Z"),
          ready: true,
        }),
      ]);
      expect(await dayGear(db, w.leagueId, "2026-11-18", SATURDAY)).toEqual([]);
    });
  });

  it("reminds whoever brings a kit tomorrow, once, saying where to get it", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      expect(await queueGearReminders(db, SATURDAY)).toBe(0);
      expect(await queueGearReminders(db, MONDAY_EVENING)).toBe(1);
      expect(await queueGearReminders(db, MONDAY_EVENING)).toBe(0);
      const queued = await db
        .select({
          userId: message.userId,
          topic: message.topic,
          payload: message.payload,
        })
        .from(message)
        .where(
          and(eq(message.template, "gear_reminder"), eq(message.userId, w.jo)),
        );
      expect(queued).toEqual([
        {
          userId: w.jo,
          topic: "game_reminder",
          payload: expect.objectContaining({
            kitName: "Kit A",
            place: "Park, Field 2",
            from: { kind: "at_home", homeLocation: "Park house locker" },
          }),
        },
      ]);
    });
  });

  it("retires a kit only from home, dropping its games to come", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await pickUpKit(db, { kitId: w.kitId, actorId: w.jo, now: SATURDAY });
      const retire = () =>
        retireKit(db, {
          kitId: w.kitId,
          leagueId: w.leagueId,
          actorId: w.admin.userId,
          now: SATURDAY,
        });
      expect(await retire()).toEqual({ ok: false, error: "out" });
      await returnKitHome(db, { kitId: w.kitId, actorId: w.jo, now: SATURDAY });
      expect(await retire()).toEqual({ ok: true, value: null });
      expect(await leagueKits(db, w.leagueId, SATURDAY)).toEqual([]);
      expect(await myGear(db, w.sam, SATURDAY)).toEqual([]);
      expect(await queueGearReminders(db, MONDAY_EVENING)).toBe(0);
    });
  });
});
