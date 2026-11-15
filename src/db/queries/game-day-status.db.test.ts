import { and, eq, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { StatusInput } from "@/domain/gameday/status";
import { ok } from "@/domain/result";
import { rendererFor } from "@/emails/templates";
import type { Email, EmailSender } from "@/services/email";
import type { SchedulerInput } from "@/domain/scheduler/types";
import { auditLog } from "../schema/audit";
import { leagueMember } from "../schema/league";
import { message, notificationPreference } from "../schema/message";
import { gamePlacement, scheduleVersion } from "../schema/schedule";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { dayGames, setDayStatus, statusesFrom } from "./game-day-status";
import { drainOutbox } from "./outbox";
import { required } from "./rows";
import type { Db } from "./schedule";

afterAll(closePool);

const render = rendererFor({ siteUrl: "https://league.example.test" });
const TZ = "America/New_York";
const DATE = "2026-09-15";
/** EDT wall-clock on Tuesday, Sep 15, 2026. */
const edt = (hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 8, 15, hour + 4, minute));

/**
 * The messaging world with a published schedule for one Tuesday: Aces vs
 * Bees at 6 pm and Cats vs Dogs at 7 pm, each team with a player or two.
 */
async function dayWorld(db: Db) {
  const w = await messagingWorld(db);
  const cats = await w.entry("Cats");
  const dogs = await w.entry("Dogs");
  const cat = await w.person("cat-1");
  const dog = await w.person("dog-1");
  await w.join(cats, cat);
  await w.join(dogs, dog);
  // An admin of this league, who gets the decision-time reminder.
  const admin = await w.person("admin-1");
  await db
    .insert(leagueMember)
    .values({ leagueId: w.leagueId, userId: admin.userId, role: "admin" });
  const version = required(
    (
      await db
        .insert(scheduleVersion)
        .values({
          seasonId: w.season.id,
          versionNo: 1,
          status: "published",
          publishedAt: edt(9),
          origin: "manual_edit",
          inputSnapshot: {} as SchedulerInput,
        })
        .returning({ id: scheduleVersion.id })
    )[0],
    "version",
  );
  const early = await w.gameEnding(edt(19));
  const late = await w.gameBetween(cats, dogs, edt(20));
  for (const g of [early, late])
    await db.insert(gamePlacement).values({
      scheduleVersionId: version.id,
      gameId: g.gameId,
      slotId: g.slotId,
    });
  const season = { ...w.season, timeZone: TZ };
  const games = await dayGames(db, w.season.id, DATE, TZ);
  return { ...w, cat, dog, admin, early, late, season, games };
}

type World = Awaited<ReturnType<typeof dayWorld>>;

const save = (
  db: Db,
  w: World,
  status: StatusInput,
  now = edt(13),
  actorId = w.aces.captain.userId,
) =>
  setDayStatus(db, {
    season: w.season,
    date: DATE,
    status,
    games: w.games,
    actorId,
    now,
  });

const on: StatusInput = {
  state: "on",
  decideBy: null,
  reason: null,
  games: new Map(),
};

const queued = async (db: Db, prefix: string) =>
  db
    .select({
      userId: message.userId,
      status: message.status,
      sendAfter: message.sendAfter,
      topic: message.topic,
      payload: message.payload,
    })
    .from(message)
    .where(like(message.dedupeKey, `${prefix}%`));

describe("a game day's status", () => {
  it("lists the day's published games in start order", async () => {
    await inRolledBackDb(async (db) => {
      const w = await dayWorld(db);
      expect(w.games.map((g) => [g.teams, g.startsAt])).toEqual([
        ["Aces vs Bees", edt(18)],
        ["Cats vs Dogs", edt(19)],
      ]);
    });
  });

  it("tells only the called-off game's players, once, and audits the change", async () => {
    await inRolledBackDb(async (db) => {
      const w = await dayWorld(db);
      const off: StatusInput = {
        state: "off",
        decideBy: null,
        reason: "No lights",
        games: new Map([[w.late.gameId, null]]),
      };
      const first = await save(db, w, off);
      expect(first.told).toBe(2);
      const sent = await queued(db, `game-day/${w.late.gameId}/off/`);
      expect(sent.map((m) => m.userId).sort()).toEqual(
        [w.cat.userId, w.dog.userId].sort(),
      );
      expect(sent[0]?.payload).toMatchObject({
        kind: "off",
        teams: "Cats vs Dogs",
        was: "7:00 PM",
        reason: "No lights",
      });
      expect(await queued(db, `game-day/${w.early.gameId}/`)).toEqual([]);

      // Saving the same status again tells nobody.
      expect((await save(db, w, off, edt(13, 5))).told).toBe(0);

      const audits = await db
        .select({ after: auditLog.after })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "game_day.status"),
            eq(auditLog.entityId, w.season.id),
          ),
        );
      expect(audits).toHaveLength(2);

      const saved = await statusesFrom(db, w.season.id, DATE);
      expect(saved.get(DATE)).toMatchObject({
        state: "off",
        reason: "No lights",
        games: new Map([[w.late.gameId, null]]),
      });
    });
  });

  it("tells a delayed game's players the new time, and again if it moves", async () => {
    await inRolledBackDb(async (db) => {
      const w = await dayWorld(db);
      const delay = (start: Date): StatusInput => ({
        state: "delayed",
        decideBy: null,
        reason: null,
        games: new Map([[w.early.gameId, start]]),
      });
      await save(db, w, delay(edt(18, 30)));
      await save(db, w, delay(edt(19, 0)), edt(13, 10));
      const sent = await queued(db, `game-day/${w.early.gameId}/delayed/`);
      // Two Aces and two Bees on active rosters, told twice.
      expect(
        sent.map((m) => (m.payload as { newStart: string }).newStart).sort(),
      ).toEqual(
        [
          ...Array(sent.length / 2).fill("6:30 PM"),
          ...Array(sent.length / 2).fill("7:00 PM"),
        ].sort(),
      );

      // Back on its schedule: the same players hear it's back on.
      const back = await save(db, w, on, edt(13, 20));
      expect(back.told).toBe(sent.length / 2);
      expect(
        (await queued(db, `game-day/${w.early.gameId}/back_on/`)).length,
      ).toBe(sent.length / 2);
    });
  });

  it("sends a weather watch only to players who asked for one", async () => {
    await inRolledBackDb(async (db) => {
      const w = await dayWorld(db);
      await db.insert(notificationPreference).values({
        userId: w.cat.userId,
        topic: "game_day_watch",
        channel: "email",
        enabled: true,
      });
      const watching: StatusInput = {
        state: "watching",
        decideBy: edt(15),
        reason: "Storms",
        games: new Map(),
      };
      const result = await save(db, w, watching);
      expect(result.told).toBe(0);
      const watches = await queued(db, "game-day-watch/");
      expect(watches.length).toBe(result.watchers);
      expect(watches.every((m) => m.topic === "game_day_watch")).toBe(true);
      // The outbox delivers by topic: only the player who turned watches
      // on gets one; everyone else's stays off by default.
      const sent: Email[] = [];
      const send: EmailSender = async (email) => {
        sent.push(email);
        return ok({ id: `provider-${sent.length}` });
      };
      await drainOutbox(db, { send, render, now: edt(13), limit: 500 });
      const watchMail = sent.filter((e) =>
        e.subject.startsWith("Watching the weather"),
      );
      expect(watchMail.map((e) => e.to)).toEqual([w.cat.email]);
      expect(watchMail[0]?.text).toContain("decide by 3:00 PM");
    });
  });

  it("reminds admins at the decision time, unless the status changes first", async () => {
    await inRolledBackDb(async (db) => {
      const w = await dayWorld(db);
      const watching: StatusInput = {
        state: "watching",
        decideBy: edt(15),
        reason: null,
        games: new Map(),
      };
      const saved = await save(db, w, watching);
      const statusId = required(
        (await statusesFrom(db, w.season.id, DATE)).get(DATE),
        "status",
      ).id;
      const reminders = await queued(db, `game-day-decide/${statusId}/`);
      expect(reminders).toHaveLength(saved.reminders);
      // This league's admin is reminded; nobody from other leagues is.
      expect(reminders.map((m) => m.userId)).toEqual([w.admin.userId]);
      expect(
        reminders.every((m) => m.sendAfter.getTime() === edt(15).getTime()),
      ).toBe(true);
      expect(reminders.every((m) => m.status === "queued")).toBe(true);

      // A decision before 3 pm: the reminder is not needed.
      await save(db, w, on, edt(14));
      expect(
        (await queued(db, `game-day-decide/${statusId}/`)).every(
          (m) => m.status === "suppressed",
        ),
      ).toBe(true);
    });
  });
});
