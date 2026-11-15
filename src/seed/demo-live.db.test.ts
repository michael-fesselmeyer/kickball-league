import { and, asc, desc, eq, inArray, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { nextGameDayStart } from "@/db/queries/demo";
import { required } from "@/db/queries/rows";
import type { Db } from "@/db/queries/schedule";
import { user } from "@/db/schema/auth";
import {
  game,
  gamePeriod,
  refereeAssignment,
  slot,
  venue,
} from "@/db/schema/game";
import { message } from "@/db/schema/message";
import { profile } from "@/db/schema/profile";
import { gamePlacement, scheduleVersion } from "@/db/schema/schedule";
import { season } from "@/db/schema/season";
import { messagingWorld } from "@/db/test/messaging-world";
import { closePool, inRolledBackDb } from "@/db/test/transaction";
import type { FieldId, GameId, SlotId } from "@/domain/ids";
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
      refereeId: PERSONA_IDS.ref,
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
  const nextBeside = await at(
    2,
    new Date(edt(11, 20).getTime() + HOUR),
    otherField,
  );
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
    [played, nextFirst, nextBeside, nextSecond, later].map((g) => ({
      scheduleVersionId: version.id,
      gameId: g.gameId,
      slotId: g.slotId,
    })),
  );
  return { ...w, admin, played, nextFirst, nextBeside, nextSecond, later };
}

/** A live game's runs so far, by the team kicking in the top and bottom halves. */
async function linescore(db: Db, gameId: GameId) {
  const halves = await db
    .select({ half: gamePeriod.half, runs: gamePeriod.runs })
    .from(gamePeriod)
    .where(eq(gamePeriod.gameId, gameId));
  const total = (half: "top" | "bottom") =>
    halves.filter((h) => h.half === half).reduce((n, h) => n + h.runs, 0);
  return { halves: halves.length, top: total("top"), bottom: total("bottom") };
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
  it("moves the next round to tonight and starts its first games a few innings in", () =>
    inRolledBackDb(async (db) => {
      const w = await nightWorld(db);
      const done = await liveDemo(db, NOW);
      const first = [w.nextFirst.gameId, w.nextBeside.gameId];
      expect(first).toContain(done.liveGameId);

      // 40 minutes ago, on a five-minute mark; the round keeps its spacing.
      for (const g of [w.nextFirst, w.nextBeside])
        expect(await startOf(db, g.slotId)).toEqual(
          new Date("2027-05-10T17:20:00Z"),
        );
      expect(await startOf(db, w.nextSecond.slotId)).toEqual(
        new Date("2027-05-10T18:20:00Z"),
      );
      expect(await startOf(db, w.later.slotId)).toEqual(edt(18, 20));
      expect(await startOf(db, w.played.slotId)).toEqual(edt(4, 20));

      // Both early games are live, each with its own score; the later one
      // hasn't started.
      const states = await db
        .select({
          id: game.id,
          status: game.status,
          kicksFirst: game.kicksFirst,
        })
        .from(game)
        .where(inArray(game.id, [...first, w.nextSecond.gameId]))
        .orderBy(asc(game.id));
      for (const s of states)
        expect(s).toEqual(
          s.id === w.nextSecond.gameId
            ? { id: s.id, status: "scheduled", kicksFirst: null }
            : { id: s.id, status: "in_progress", kicksFirst: w.aces.id },
        );
      const lines = await Promise.all(first.map((id) => linescore(db, id)));
      for (const line of lines) expect(line.halves).toBe(7);
      expect(new Set(lines.map((l) => `${l.top}-${l.bottom}`)).size).toBe(2);
      expect(await linescore(db, w.nextSecond.gameId)).toEqual({
        halves: 0,
        top: 0,
        bottom: 0,
      });
      const [last] = await db
        .select({
          periodNo: gamePeriod.periodNo,
          half: gamePeriod.half,
          enteredBy: gamePeriod.enteredBy,
        })
        .from(gamePeriod)
        .where(eq(gamePeriod.gameId, w.nextFirst.gameId))
        .orderBy(desc(gamePeriod.enteredAt))
        .limit(1);
      expect(last).toEqual({
        periodNo: 4,
        half: "top",
        enteredBy: PERSONA_IDS.ref,
      });

      // The demo ref is at the field for tonight's games, not next week's.
      const checkIns = await db
        .select({
          gameId: refereeAssignment.gameId,
          checkedInAt: refereeAssignment.checkedInAt,
        })
        .from(refereeAssignment)
        .where(eq(refereeAssignment.userId, PERSONA_IDS.ref));
      for (const c of checkIns)
        expect(c.checkedInAt !== null).toBe(
          [...first, w.nextSecond.gameId].includes(c.gameId),
        );
    }));

  it("keeps tonight's games on today just after midnight", () =>
    inRolledBackDb(async (db) => {
      const w = await nightWorld(db);
      // 12:10 am in New York: 40 minutes ago was yesterday.
      await liveDemo(db, new Date("2027-05-11T04:10:00Z"));
      expect(await startOf(db, w.nextFirst.slotId)).toEqual(
        new Date("2027-05-11T04:00:00Z"),
      );
      expect(await startOf(db, w.nextSecond.slotId)).toEqual(
        new Date("2027-05-11T05:00:00Z"),
      );
    }));

  it("leaves a game night already under way as it is", () =>
    inRolledBackDb(async (db) => {
      const w = await nightWorld(db);
      const once = await liveDemo(db, NOW);
      const later = new Date(NOW.getTime() + 2 * HOUR);
      const twice = await liveDemo(db, later);
      expect(twice.liveGameId).toBe(once.liveGameId);
      expect(await startOf(db, w.nextFirst.slotId)).toEqual(
        new Date("2027-05-10T17:20:00Z"),
      );
      expect((await linescore(db, w.nextFirst.gameId)).halves).toBe(7);
      // The rain alert is not sent twice.
      expect(twice.rainWatchFrom).toEqual(edt(18, 20));
      const alerts = await db
        .select({ id: message.id })
        .from(message)
        .where(like(message.dedupeKey, `rain-alert/${w.season.id}/%`));
      expect(alerts).toHaveLength(1);
    }));

  it("starts nothing when no season is being played", () =>
    inRolledBackDb(async (db) => {
      const w = await nightWorld(db);
      await db
        .update(season)
        .set({ status: "completed" })
        .where(eq(season.status, "in_progress"));
      const done = await liveDemo(db, NOW);
      expect(done.liveGameId).toBeNull();
      expect(await startOf(db, w.nextFirst.slotId)).toEqual(edt(11, 20));
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
