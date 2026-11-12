import { eq, inArray, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { SchedulerInput } from "@/domain/scheduler/types";
import { ok } from "@/domain/result";
import type { ForecastHour } from "@/domain/weather/forecast";
import { rendererFor } from "@/emails/templates";
import type { Email, EmailSender } from "@/services/email";
import hourlyFixture from "@/services/fixtures/nws-hourly.json";
import { parseHourly } from "@/services/weather";
import { slot, venue } from "../schema/game";
import { message } from "../schema/message";
import { profile } from "../schema/profile";
import { gamePlacement, scheduleVersion } from "../schema/schedule";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { drainOutbox } from "./outbox";
import {
  checkRain,
  type ForecastLookup,
  gameDaysDue,
  queueRainAlerts,
} from "./rain-alerts";
import { required } from "./rows";
import type { Db } from "./schedule";

afterAll(closePool);

const parsed = parseHourly(hourlyFixture);
if (!parsed.ok) throw new Error(parsed.error);
const HOURS: ForecastHour[] = parsed.value;

/** The recorded forecast, for any place; no network. */
const recorded: ForecastLookup = async () => HOURS;
const render = rendererFor({ siteUrl: "https://league.example.test" });

/** An EDT wall-clock time on a September 2026 day. */
const edt = (day: number, hour: number) =>
  new Date(Date.UTC(2026, 8, day, hour + 4));
/** Saturday evening, the day before the Sunday games. */
const SAT_EVENING = edt(12, 18);

/**
 * The messaging world's season with a pinned park, an admin, an owner, and
 * a published schedule holding one game per kickoff given (Sunday, EDT).
 */
async function rainWorld(db: Db, sundayKickoffs: number[]) {
  const w = await messagingWorld(db);
  await db
    .update(venue)
    .set({ lat: "40.720600", lng: "-73.951300" })
    .where(eq(venue.leagueId, w.leagueId));
  const admin = await w.person("admin");
  const owner = await w.person("owner");
  await db.insert(profile).values([
    { userId: admin.userId, globalRole: "admin" },
    { userId: owner.userId, globalRole: "owner" },
  ]);
  const version = required(
    (
      await db
        .insert(scheduleVersion)
        .values({
          seasonId: w.season.id,
          versionNo: 1,
          status: "published",
          publishedAt: SAT_EVENING,
          origin: "manual_edit",
          inputSnapshot: {} as SchedulerInput,
        })
        .returning({ id: scheduleVersion.id })
    )[0],
    "version",
  );
  const games = [];
  for (const hour of sundayKickoffs) {
    const g = await w.gameEnding(new Date(edt(13, hour).getTime() + 3_600_000));
    await db.insert(gamePlacement).values({
      scheduleVersionId: version.id,
      gameId: g.gameId,
      slotId: g.slotId,
    });
    games.push(g);
  }
  // Alerts go to every admin, including any a seeded database already has.
  const admins = (
    await db
      .select({ id: profile.userId })
      .from(profile)
      .where(inArray(profile.globalRole, ["admin", "owner"]))
  ).length;
  return { ...w, admin, owner, admins, games };
}

const alertKeys = async (db: Db, seasonId: string) =>
  (
    await db
      .select({ key: message.dedupeKey })
      .from(message)
      .where(like(message.dedupeKey, `rain-alert/${seasonId}/%`))
  )
    .map((r) => r.key)
    .sort();

async function runJob(db: Db, now: Date, forecast = recorded) {
  const checks = await checkRain(await gameDaysDue(db, now), forecast);
  return { checks, queued: await queueRainAlerts(db, checks, now) };
}

describe("rain alerts", () => {
  it("puts an afternoon of showers on watch and tells each admin once", async () => {
    await inRolledBackDb(async (db) => {
      const w = await rainWorld(db, [13, 15]);
      const { checks, queued } = await runJob(db, SAT_EVENING);
      expect(checks.map((c) => [c.day.date, c.risk.level])).toEqual([
        ["2026-09-13", "watch"],
      ]);
      expect(queued).toBe(w.admins);
      expect((await runJob(db, edt(12, 21))).queued).toBe(0);
      const keys = await alertKeys(db, w.season.id);
      expect(keys).toHaveLength(w.admins);
      expect(keys).toEqual(
        expect.arrayContaining([
          `rain-alert/${w.season.id}/2026-09-13/watch/${w.admin.userId}`,
          `rain-alert/${w.season.id}/2026-09-13/watch/${w.owner.userId}`,
        ]),
      );

      const sent: Email[] = [];
      const send: EmailSender = async (email) => {
        sent.push(email);
        return ok({ id: `provider-${sent.length}` });
      };
      await drainOutbox(db, { send, render, now: SAT_EVENING, limit: 500 });
      const ours = sent.filter((e) =>
        [w.admin.email, w.owner.email].includes(e.to),
      );
      expect(ours.map((e) => e.to).sort()).toEqual(
        [w.admin.email, w.owner.email].sort(),
      );
      expect(ours[0]?.subject).toBe("Rain watch Sun, Sep 13: Fall 2026");
      expect(ours[0]?.text).toContain("2 games on Sun, Sep 13, from 1:00 PM");
      expect(ours[0]?.text).toContain(
        `/app/admin/seasons/${w.season.slug}/rainout?date=2026-09-13`,
      );
    });
  });

  it("follows a watch with one likely alert when storms are on, then nothing more", async () => {
    await inRolledBackDb(async (db) => {
      const w = await rainWorld(db, [15]);
      expect((await runJob(db, SAT_EVENING)).queued).toBe(w.admins);

      // A night game is added under the storms.
      const late = await w.gameEnding(edt(13, 20));
      const [version] = await db
        .select({ id: scheduleVersion.id })
        .from(scheduleVersion)
        .where(eq(scheduleVersion.seasonId, w.season.id));
      await db.insert(gamePlacement).values({
        scheduleVersionId: required(version, "version").id,
        gameId: late.gameId,
        slotId: late.slotId,
      });
      const { checks, queued } = await runJob(db, edt(12, 20));
      expect(checks[0]?.risk).toEqual({
        level: "likely",
        peakChance: 78,
        thunder: true,
        covered: 2,
      });
      expect(queued).toBe(w.admins);

      // The night game is called off; the day is back to watch, which was sent.
      await db
        .update(slot)
        .set({ status: "cancelled" })
        .where(eq(slot.id, late.slotId));
      expect((await runJob(db, edt(12, 22))).queued).toBe(0);
      expect(await alertKeys(db, w.season.id)).toHaveLength(2 * w.admins);
    });
  });

  it("does not repeat a watch after a likely alert for the same day", async () => {
    await inRolledBackDb(async (db) => {
      const w = await rainWorld(db, [15, 19]);
      expect((await runJob(db, SAT_EVENING)).queued).toBe(w.admins);
      await db
        .update(slot)
        .set({ status: "cancelled" })
        .where(eq(slot.id, required(w.games[1], "game").slotId));
      expect((await runJob(db, edt(12, 21))).queued).toBe(0);
      expect(
        (await alertKeys(db, w.season.id)).every((k) => k.includes("/likely/")),
      ).toBe(true);
    });
  });

  it("stays quiet on a dry day, too far ahead, or without a forecast", async () => {
    await inRolledBackDb(async (db) => {
      const w = await rainWorld(db, [10, 13]);
      const dry = await runJob(db, SAT_EVENING);
      expect(dry.checks[0]?.risk.level).toBe("low");
      expect(dry.queued).toBe(0);

      expect(await gameDaysDue(db, edt(11, 18))).toEqual([]);

      const stormy = HOURS.map((h) => ({ ...h, precipChance: 90 }));
      expect((await runJob(db, SAT_EVENING, async () => null)).queued).toBe(0);
      expect((await runJob(db, edt(13, 14), async () => stormy)).queued).toBe(
        0,
      );
      expect(await alertKeys(db, w.season.id)).toEqual([]);
    });
  });

  it("ignores unpublished games and games at a park with no map pin", async () => {
    await inRolledBackDb(async (db) => {
      const w = await rainWorld(db, [19]);
      await w.gameEnding(edt(13, 14)); // 1 PM, in no published version
      const [day] = await gameDaysDue(db, SAT_EVENING);
      expect(day?.games).toHaveLength(1);
      expect(day?.firstPitch).toEqual(edt(13, 19));

      await db
        .update(venue)
        .set({ lat: null, lng: null })
        .where(eq(venue.leagueId, w.leagueId));
      expect(await gameDaysDue(db, SAT_EVENING)).toEqual([]);
    });
  });
});
