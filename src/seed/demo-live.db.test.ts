import { and, asc, desc, eq, inArray, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { nextGameDayStart } from "@/db/queries/demo";
import { permitInfoFor } from "@/db/queries/permit-watch";
import { required } from "@/db/queries/rows";
import type { Db } from "@/db/queries/schedule";
import { user } from "@/db/schema/auth";
import {
  game,
  gamePeriod,
  gameStart,
  refereeAssignment,
  slot,
  venue,
} from "@/db/schema/game";
import { message } from "@/db/schema/message";
import { profile } from "@/db/schema/profile";
import { refereeProfile } from "@/db/schema/referees";
import {
  gamePlacement,
  permitWindow,
  scheduleVersion,
} from "@/db/schema/schedule";
import { league } from "@/db/schema/league";
import { season } from "@/db/schema/season";
import { grantRole } from "@/db/test/leagues";
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
    .values({ userId: admin.userId })
    .onConflictDoNothing();
  // An admin of this league (ADR 0048): the rain alert goes to them.
  await grantRole(db, admin.userId, "admin", w.leagueId);
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
      const done = await liveDemo(db, w.leagueId, NOW);
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

  it("gives the demo ref's second game at one kickoff to another pooled ref", () =>
    inRolledBackDb(async (db) => {
      const w = await nightWorld(db);
      const other = await w.person("other-ref");
      await db.insert(refereeProfile).values([
        { leagueId: w.leagueId, userId: PERSONA_IDS.ref },
        { leagueId: w.leagueId, userId: other.userId },
      ]);
      await liveDemo(db, w.leagueId, NOW);
      const refs = await db
        .select({
          gameId: refereeAssignment.gameId,
          userId: refereeAssignment.userId,
          checkedInAt: refereeAssignment.checkedInAt,
        })
        .from(refereeAssignment)
        .where(
          inArray(refereeAssignment.gameId, [
            w.nextFirst.gameId,
            w.nextBeside.gameId,
            w.nextSecond.gameId,
          ]),
        );
      const byGame = new Map(refs.map((r) => [r.gameId, r]));
      const early = [w.nextFirst.gameId, w.nextBeside.gameId].map(
        (id) => byGame.get(id)?.userId,
      );
      // One early game each, and the demo ref keeps the later one.
      expect(new Set(early)).toEqual(new Set([PERSONA_IDS.ref, other.userId]));
      expect(byGame.get(w.nextSecond.gameId)?.userId).toBe(PERSONA_IDS.ref);
      // Both are at the field, and each game's innings are its own ref's.
      for (const r of refs) expect(r.checkedInAt).not.toBeNull();
      const entered = await db
        .selectDistinct({
          gameId: gamePeriod.gameId,
          enteredBy: gamePeriod.enteredBy,
        })
        .from(gamePeriod)
        .where(
          inArray(gamePeriod.gameId, [w.nextFirst.gameId, w.nextBeside.gameId]),
        );
      for (const e of entered)
        expect(e.enteredBy).toBe(byGame.get(e.gameId)?.userId);
    }));

  it("records first pitch for the live games only", () =>
    inRolledBackDb(async (db) => {
      const w = await nightWorld(db);
      await liveDemo(db, w.leagueId, NOW);
      const starts = await db
        .select({
          gameId: gameStart.gameId,
          startedAt: gameStart.startedAt,
          recordedBy: gameStart.recordedBy,
        })
        .from(gameStart)
        .where(
          inArray(gameStart.gameId, [
            w.nextFirst.gameId,
            w.nextBeside.gameId,
            w.nextSecond.gameId,
          ]),
        );
      expect(starts.map((s) => s.gameId).sort()).toEqual(
        [w.nextFirst.gameId, w.nextBeside.gameId].sort(),
      );
      for (const s of starts)
        expect(s).toMatchObject({
          startedAt: new Date("2027-05-10T17:20:00Z"),
          recordedBy: PERSONA_IDS.ref,
        });
    }));

  it("moves the round's permit windows, and the slots cut from them, with its games", () =>
    inRolledBackDb(async (db) => {
      const w = await nightWorld(db);
      const [first] = await db
        .select({ fieldId: slot.fieldId, seasonId: slot.seasonId })
        .from(slot)
        .where(eq(slot.id, w.nextFirst.slotId));
      if (!first) throw new Error("no slot");
      // Next Tuesday's 8 to 10 pm permit on the game's field, with an
      // unused 9 pm slot cut from it.
      const window = required(
        (
          await db
            .insert(permitWindow)
            .values({
              fieldId: first.fieldId,
              seasonId: first.seasonId,
              startsAt: edt(11, 20),
              endsAt: edt(11, 22),
              status: "confirmed",
            })
            .returning({ id: permitWindow.id })
        )[0],
        "window",
      );
      const unused = required(
        (
          await db
            .insert(slot)
            .values({
              seasonId: first.seasonId,
              fieldId: first.fieldId,
              permitWindowId: window.id,
              startsAt: edt(11, 21),
              endsAt: edt(11, 22),
              timeIndex: 1,
            })
            .returning({ id: slot.id })
        )[0],
        "slot",
      );
      await db
        .update(slot)
        .set({ permitWindowId: window.id })
        .where(eq(slot.id, w.nextFirst.slotId));

      await liveDemo(db, w.leagueId, NOW);

      // The game moved from 8 pm next Tuesday to 1:20 pm today; its window
      // and the other slot cut from it moved by as much.
      const moved = edt(11, 20).getTime() - Date.parse("2027-05-10T17:20:00Z");
      const [after] = await db
        .select({
          startsAt: permitWindow.startsAt,
          endsAt: permitWindow.endsAt,
        })
        .from(permitWindow)
        .where(eq(permitWindow.id, window.id));
      expect(after).toEqual({
        startsAt: new Date("2027-05-10T17:20:00Z"),
        endsAt: new Date(edt(11, 22).getTime() - moved),
      });
      expect(await startOf(db, unused.id)).toEqual(
        new Date(edt(11, 21).getTime() - moved),
      );
      // The game's clock now reads from today's permit.
      const info = (await permitInfoFor(db, [w.nextFirst.gameId])).get(
        w.nextFirst.gameId,
      );
      expect(info?.clearBy).toEqual(new Date(edt(11, 22).getTime() - moved));
    }));

  it("keeps tonight's games on today just after midnight", () =>
    inRolledBackDb(async (db) => {
      const w = await nightWorld(db);
      // 12:10 am in New York: 40 minutes ago was yesterday.
      await liveDemo(db, w.leagueId, new Date("2027-05-11T04:10:00Z"));
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
      const once = await liveDemo(db, w.leagueId, NOW);
      const later = new Date(NOW.getTime() + 2 * HOUR);
      const twice = await liveDemo(db, w.leagueId, later);
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
      const done = await liveDemo(db, w.leagueId, NOW);
      expect(done.liveGameId).toBeNull();
      expect(await startOf(db, w.nextFirst.slotId)).toEqual(edt(11, 20));
    }));

  it("leaves another league's games alone (ADR 0048)", () =>
    inRolledBackDb(async (db) => {
      const w = await nightWorld(db);
      const [other] = await db
        .insert(league)
        .values({ name: "Other league", slug: `other-${w.tag}` })
        .returning({ id: league.id });
      const done = await liveDemo(db, other!.id, NOW);
      expect(done).toEqual({
        liveGameId: null,
        rainWatchFrom: null,
        queued: 0,
      });
      expect(await startOf(db, w.nextFirst.slotId)).toEqual(edt(11, 20));
      expect((await linescore(db, w.nextFirst.gameId)).halves).toBe(0);
    }));

  it("puts a rain watch on the next game day and the admins' alert in the mail", () =>
    inRolledBackDb(async (db) => {
      const w = await nightWorld(db);
      const done = await liveDemo(db, w.leagueId, NOW);
      expect(done.rainWatchFrom).toEqual(edt(18, 20));
      expect(await nextGameDayStart(db, w.leagueId, NOW)).toEqual(edt(18, 20));
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
