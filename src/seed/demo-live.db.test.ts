import { and, asc, eq, inArray, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { nextGameDayStart } from "@/db/queries/demo";
import { required } from "@/db/queries/rows";
import type { Db } from "@/db/queries/schedule";
import { user } from "@/db/schema/auth";
import { game, gamePeriod, slot, venue } from "@/db/schema/game";
import { message } from "@/db/schema/message";
import { profile } from "@/db/schema/profile";
import { gamePlacement, scheduleVersion } from "@/db/schema/schedule";
import { season } from "@/db/schema/season";
import { messagingWorld } from "@/db/test/messaging-world";
import { closePool, inRolledBackDb } from "@/db/test/transaction";
import type { FieldId, SlotId } from "@/domain/ids";
import type { SchedulerInput } from "@/domain/scheduler/types";
import { liveDemo } from "./demo-live";
import { PERSONA_IDS } from "./demo-personas";

afterAll(closePool);

/** Monday afternoon, May 10 2027, in New York (EDT). */
const NOW = new Date("2027-05-10T18:02:00Z");
/** An EDT wall-clock hour on a May 2027 day. */
const edt = (day: number, hour: number) =>
  new Date(Date.UTC(2027, 4, day, hour + 4));
const HOUR = 3_600_000;

/**
 * A season in progress: round 1 played, round 2 next Tuesday at 8 and 9 pm
 * on two fields, round 3 the Tuesday after, published so the rain alert job
 * sees it. A pinned park and an admin to alert.
 */
async function nightWorld(db: Db) {
  const w = await messagingWorld(db);
  await db
    .update(season)
    .set({ status: "in_progress" })
    .where(eq(season.id, w.season.id));
  await db
    .update(venue)
    .set({ lat: "40.720600", lng: "-73.951300" })
    .where(eq(venue.leagueId, w.leagueId));
  const admin = await w.person("admin");
  await db
    .insert(profile)
    .values({ userId: admin.userId, globalRole: "admin" })
    .onConflictDoUpdate({
      target: profile.userId,
      set: { globalRole: "admin" },
    });
  await db
    .insert(user)
    .values({
      id: PERSONA_IDS.ref,
      name: "Reese Ref",
      email: "reese.ref@example.test",
    })
    .onConflictDoNothing();
  const otherField = await w.addField("Back field");

  const at = async (round: number, endsAt: Date, onField?: FieldId) => {
    const g = await w.gameBetween(w.aces.id, w.bees.id, endsAt, {
      ...(onField ? { onField } : {}),
    });
    await db.update(game).set({ roundNo: round }).where(eq(game.id, g.gameId));
    return g;
  };
  const played = await at(1, new Date(edt(4, 20).getTime() + HOUR));
  await db
    .update(game)
    .set({ status: "final", scoreA: 4, scoreB: 2, finalizedAt: edt(4, 21) })
    .where(eq(game.id, played.gameId));
  const nextFirst = await at(2, new Date(edt(11, 20).getTime() + HOUR));
  const nextSecond = await at(
    2,
    new Date(edt(11, 21).getTime() + HOUR),
    otherField,
  );
  const later = await at(3, new Date(edt(18, 20).getTime() + HOUR));

  const version = required(
    (
      await db
        .insert(scheduleVersion)
        .values({
          seasonId: w.season.id,
          versionNo: 1,
          status: "published",
          publishedAt: edt(1, 12),
          origin: "manual_edit",
          inputSnapshot: {} as SchedulerInput,
        })
        .returning({ id: scheduleVersion.id })
    )[0],
    "version",
  );
  await db.insert(gamePlacement).values(
    [played, nextFirst, nextSecond, later].map((g) => ({
      scheduleVersionId: version.id,
      gameId: g.gameId,
      slotId: g.slotId,
    })),
  );
  return { ...w, admin, played, nextFirst, nextSecond, later };
}

const startOf = async (db: Db, slotId: SlotId) =>
  required(
    (
      await db
        .select({ startsAt: slot.startsAt })
        .from(slot)
        .where(eq(slot.id, slotId))
    )[0],
    "slot",
  ).startsAt;

describe("liveDemo", () => {
  it("moves the next round to tonight and starts its first game a few innings in", () =>
    inRolledBackDb(async (db) => {
      const w = await nightWorld(db);
      const done = await liveDemo(db, NOW);
      expect(done.liveGameId).toBe(w.nextFirst.gameId);

      // 40 minutes ago, on a five-minute mark; the round keeps its spacing.
      expect(await startOf(db, w.nextFirst.slotId)).toEqual(
        new Date("2027-05-10T17:20:00Z"),
      );
      expect(await startOf(db, w.nextSecond.slotId)).toEqual(
        new Date("2027-05-10T18:20:00Z"),
      );
      expect(await startOf(db, w.later.slotId)).toEqual(edt(18, 20));
      expect(await startOf(db, w.played.slotId)).toEqual(edt(4, 20));

      const [live] = await db
        .select({ status: game.status, kicksFirst: game.kicksFirst })
        .from(game)
        .where(eq(game.id, w.nextFirst.gameId));
      expect(live).toEqual({ status: "in_progress", kicksFirst: w.aces.id });
      const halves = await db
        .select({
          periodNo: gamePeriod.periodNo,
          half: gamePeriod.half,
          runs: gamePeriod.runs,
          enteredBy: gamePeriod.enteredBy,
        })
        .from(gamePeriod)
        .where(eq(gamePeriod.gameId, w.nextFirst.gameId))
        .orderBy(asc(gamePeriod.enteredAt));
      expect(halves).toHaveLength(7);
      expect(halves.at(-1)).toMatchObject({ periodNo: 4, half: "top" });
      const runs = (half: "top" | "bottom") =>
        halves.filter((h) => h.half === half).reduce((n, h) => n + h.runs, 0);
      expect([runs("top"), runs("bottom")]).toEqual([3, 1]);
      expect(new Set(halves.map((h) => h.enteredBy))).toEqual(
        new Set([PERSONA_IDS.ref]),
      );
      const [other] = await db
        .select({ status: game.status })
        .from(game)
        .where(eq(game.id, w.nextSecond.gameId));
      expect(other?.status).toBe("scheduled");
    }));

  it("puts a rain watch on the next game day and the admins' alert in the mail", () =>
    inRolledBackDb(async (db) => {
      const w = await nightWorld(db);
      const done = await liveDemo(db, NOW);
      expect(done.rainWatchFrom).toEqual(edt(18, 20));
      expect(await nextGameDayStart(db, NOW)).toEqual(edt(18, 20));
      const alerts = await db
        .select({ userId: message.userId, template: message.template })
        .from(message)
        .where(
          and(
            like(message.dedupeKey, `rain-alert/${w.season.id}/2027-05-18%`),
            inArray(message.userId, [w.admin.userId]),
          ),
        );
      expect(alerts).toEqual([
        { userId: w.admin.userId, template: "rain_alert" },
      ]);
      expect(done.queued).toBeGreaterThanOrEqual(1);
    }));
});
