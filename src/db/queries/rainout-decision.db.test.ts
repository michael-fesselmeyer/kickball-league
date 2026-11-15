import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { SchedulerInput } from "@/domain/scheduler/types";
import { ok } from "@/domain/result";
import { decide, type Decision } from "@/domain/weather/decision";
import type { ForecastHour } from "@/domain/weather/forecast";
import { rendererFor } from "@/emails/templates";
import type { Email, EmailSender } from "@/services/email";
import { auditLog } from "../schema/audit";
import { venue } from "../schema/game";
import { league } from "../schema/league";
import { message } from "../schema/message";
import { profile } from "../schema/profile";
import { gamePlacement, scheduleVersion } from "../schema/schedule";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { drainOutbox } from "./outbox";
import {
  adminsConfirmRainouts,
  gameDayParks,
  gameDaysForDecision,
  queueDecisionAlerts,
  rainoutRequests,
  sendRainoutToOwners,
  setAdminsConfirmRainouts,
} from "./rainout-decision";
import { required } from "./rows";
import type { Db } from "./schedule";
import { lastWeather, placeKey, saveWeather } from "./weather-snapshots";

afterAll(closePool);

const render = rendererFor({ siteUrl: "https://league.example.test" });
const TZ = "America/New_York";

/** An EDT wall-clock time on a September 2026 day. */
const edt = (day: number, hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 8, day, hour + 4, minute));

/**
 * The messaging world's season with a pinned park, an admin and an owner,
 * and a published schedule holding one game per Sunday kickoff given.
 */
async function decisionWorld(db: Db, sundayKickoffs: number[]) {
  const w = await messagingWorld(db);
  await db
    .update(venue)
    .set({ lat: "40.720600", lng: "-73.951300" })
    .where(eq(venue.leagueId, w.leagueId));
  const admin = await w.person("Jules Park");
  const owner = await w.person("Rowan Vale");
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
          publishedAt: edt(12, 9),
          origin: "manual_edit",
          inputSnapshot: {} as SchedulerInput,
        })
        .returning({ id: scheduleVersion.id })
    )[0],
    "version",
  );
  for (const hour of sundayKickoffs) {
    const g = await w.gameEnding(edt(13, hour + 1));
    await db.insert(gamePlacement).values({
      scheduleVersionId: version.id,
      gameId: g.gameId,
      slotId: g.slotId,
    });
  }
  // A seeded database may already have owners and admins of its own.
  const count = async (roles: ("owner" | "admin")[]) =>
    (
      await db
        .select({ id: profile.userId })
        .from(profile)
        .where(inArray(profile.globalRole, roles))
    ).length;
  return {
    ...w,
    admin,
    owner,
    owners: await count(["owner"]),
    admins: await count(["admin"]),
  };
}

/** A decision from a flat forecast with the given chance all afternoon. */
function decisionAt(chance: number, now: Date): Decision {
  const hours: ForecastHour[] = Array.from({ length: 12 }, (_, i) => ({
    startsAt: edt(13, 10 + i),
    endsAt: edt(13, 11 + i),
    temperatureF: 70,
    precipChance: chance,
    summary: "Rain Showers",
  }));
  return decide({
    hourly: hours,
    grid: null,
    observed: null,
    alerts: [],
    games: [{ startsAt: edt(13, 15), endsAt: edt(13, 16) }],
    now,
    timeZone: TZ,
  });
}

const keysLike = async (db: Db, prefix: string) =>
  (
    await db
      .select({ key: message.dedupeKey, userId: message.userId })
      .from(message)
      .where(like(message.dedupeKey, `${prefix}%`))
  ).sort((a, b) => (a.key ?? "").localeCompare(b.key ?? ""));

describe("who confirms rain-outs", () => {
  it("lets the owners allow admins to confirm, audited, and ignores a repeat", async () => {
    await inRolledBackDb(async (db) => {
      const w = await decisionWorld(db, []);
      expect(await adminsConfirmRainouts(db, w.leagueId)).toBe(false);
      const change = { leagueId: w.leagueId, actorId: w.owner.userId };
      expect(await setAdminsConfirmRainouts(db, { ...change, on: true })).toBe(
        true,
      );
      expect(await adminsConfirmRainouts(db, w.leagueId)).toBe(true);
      expect(await setAdminsConfirmRainouts(db, { ...change, on: true })).toBe(
        false,
      );
      const rows = await db
        .select({ actorId: auditLog.actorId, after: auditLog.after })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "rainout.confirm_policy"),
            eq(auditLog.entityId, w.leagueId),
          ),
        );
      expect(rows).toEqual([
        { actorId: w.owner.userId, after: { adminsConfirm: true } },
      ]);
      const [row] = await db
        .select({ on: league.adminsConfirmRainouts })
        .from(league)
        .where(eq(league.id, w.leagueId));
      expect(row?.on).toBe(true);
    });
  });
});

describe("sending a rain-out to the owners", () => {
  it("messages each owner once, audits every send and shows who sent it", async () => {
    await inRolledBackDb(async (db) => {
      const w = await decisionWorld(db, [15]);
      const send = (now: Date) =>
        sendRainoutToOwners(db, {
          leagueId: w.leagueId,
          season: w.season,
          date: "2026-09-13",
          day: "Sun, Sep 13",
          actorId: w.admin.userId,
          actorName: "Jules Park",
          summary: "Likely unplayable: 0.6 in fell in the last 24 hours.",
          now,
        });
      expect(await send(edt(13, 10))).toBe(w.owners);
      expect(await send(edt(13, 10, 30))).toBe(0);

      const requests = await rainoutRequests(db, w.season.id, "2026-09-13");
      expect(requests).toHaveLength(2);
      expect(requests[0]?.by).toBe("Jules Park");
      expect(await rainoutRequests(db, w.season.id, "2026-09-20")).toEqual([]);

      const keys = await keysLike(db, `rainout-request/${w.season.id}/`);
      expect(keys.map((k) => k.userId)).toContain(w.owner.userId);
      expect(keys.map((k) => k.userId)).not.toContain(w.admin.userId);

      const sent: Email[] = [];
      const sender: EmailSender = async (email) => {
        sent.push(email);
        return ok({ id: `provider-${sent.length}` });
      };
      await drainOutbox(db, {
        send: sender,
        render,
        now: edt(13, 10, 31),
        limit: 500,
      });
      const mine = sent.find((e) => e.to === w.owner.email);
      expect(mine?.subject).toBe(
        "Confirm the rain-out for Sun, Sep 13? Fall 2026",
      );
      expect(mine?.text).toContain(
        "Likely unplayable: 0.6 in fell in the last 24 hours.",
      );
    });
  });

  it("does not message an owner about their own send", async () => {
    await inRolledBackDb(async (db) => {
      const w = await decisionWorld(db, [15]);
      await sendRainoutToOwners(db, {
        leagueId: w.leagueId,
        season: w.season,
        date: "2026-09-13",
        day: "Sun, Sep 13",
        actorId: w.owner.userId,
        actorName: "Rowan Vale",
        summary: null,
        now: edt(13, 10),
      });
      const keys = await keysLike(db, `rainout-request/${w.season.id}/`);
      expect(keys.map((k) => k.userId)).not.toContain(w.owner.userId);
    });
  });
});

describe("the parks on a game day", () => {
  it("groups the day's published games by park, and leaves other days out", async () => {
    await inRolledBackDb(async (db) => {
      const w = await decisionWorld(db, [13, 15]);
      await w.gameEnding(edt(13, 20)); // in no published version
      const parks = await gameDayParks(db, w.season.id, "2026-09-13", TZ);
      expect(parks).toEqual([
        {
          venue: "Park",
          lat: 40.7206,
          lng: -73.9513,
          games: [
            { startsAt: edt(13, 13), endsAt: edt(13, 14) },
            { startsAt: edt(13, 15), endsAt: edt(13, 16) },
          ],
        },
      ]);
      expect(await gameDayParks(db, w.season.id, "2026-09-12", TZ)).toEqual([]);
    });
  });
});

describe("the decision-time alert", () => {
  it("finds a game day 2 to 8 hours before first pitch, and not otherwise", async () => {
    await inRolledBackDb(async (db) => {
      const w = await decisionWorld(db, [15, 17]);
      const ours = async (now: Date) =>
        (await gameDaysForDecision(db, now)).filter(
          (d) => d.seasonId === w.season.id,
        );
      expect((await ours(edt(13, 10))).map((d) => d.date)).toEqual([
        "2026-09-13",
      ]);
      expect((await ours(edt(13, 10)))[0]?.games).toHaveLength(2);
      expect(await ours(edt(13, 6))).toEqual([]);
      expect(await ours(edt(13, 14))).toEqual([]);
    });
  });

  it("alerts the owners once per game day on watch or likely", async () => {
    await inRolledBackDb(async (db) => {
      const w = await decisionWorld(db, [15]);
      const now = edt(13, 10);
      const [day] = (await gameDaysForDecision(db, now)).filter(
        (d) => d.seasonId === w.season.id,
      );
      if (!day) throw new Error("No game day");
      const check = (chance: number) => ({
        day,
        decision: decisionAt(chance, now),
        park: "Park",
        parks: 1,
      });

      expect(await queueDecisionAlerts(db, w.leagueId, [check(10)], now)).toBe(
        0,
      );
      expect(await queueDecisionAlerts(db, w.leagueId, [check(55)], now)).toBe(
        w.owners,
      );
      // The afternoon run finds it likely now; the day was already alerted.
      expect(
        await queueDecisionAlerts(db, w.leagueId, [check(90)], edt(13, 14)),
      ).toBe(0);
      const keys = await keysLike(db, `rain-decision/${w.season.id}/`);
      expect(keys.map((k) => k.userId)).toContain(w.owner.userId);
      expect(keys.map((k) => k.userId)).not.toContain(w.admin.userId);

      const sent: Email[] = [];
      const sender: EmailSender = async (email) => {
        sent.push(email);
        return ok({ id: `provider-${sent.length}` });
      };
      await drainOutbox(db, { send: sender, render, now, limit: 500 });
      const mine = sent.find((e) => e.to === w.owner.email);
      expect(mine?.subject).toBe("Check the weather before 3:00 PM: Fall 2026");
      expect(mine?.text).toContain("Worth watching: 55% chance of rain");
      expect(mine?.text).toContain(
        `/app/admin/seasons/${w.season.slug}/rainout?date=2026-09-13`,
      );
    });
  });

  it("alerts admins too when the owners let them confirm", async () => {
    await inRolledBackDb(async (db) => {
      const w = await decisionWorld(db, [15]);
      await setAdminsConfirmRainouts(db, {
        leagueId: w.leagueId,
        actorId: w.owner.userId,
        on: true,
      });
      const now = edt(13, 10);
      const [day] = (await gameDaysForDecision(db, now)).filter(
        (d) => d.seasonId === w.season.id,
      );
      if (!day) throw new Error("No game day");
      expect(
        await queueDecisionAlerts(
          db,
          w.leagueId,
          [{ day, decision: decisionAt(80, now), park: "Park", parks: 1 }],
          now,
        ),
      ).toBe(w.owners + w.admins);
    });
  });
});

describe("the saved weather", () => {
  it("keeps the newest answer and reads it back with its time", async () => {
    await inRolledBackDb(async (db) => {
      const place = placeKey(40.72061234, -73.95129876);
      expect(place).toBe("40.7206,-73.9513");
      const alert = {
        event: "Flood Watch",
        headline: null,
        severity: "Moderate",
        endsAt: edt(13, 20),
      };
      await saveWeather(db, place, "alerts", [alert], edt(13, 10));
      await saveWeather(db, place, "alerts", [], edt(13, 9));
      expect(await lastWeather(db, place, "alerts")).toEqual({
        value: [alert],
        fetchedAt: edt(13, 10),
      });
      await saveWeather(db, place, "alerts", [], edt(13, 11));
      expect(await lastWeather(db, place, "alerts")).toEqual({
        value: [],
        fetchedAt: edt(13, 11),
      });
      expect(await lastWeather(db, place, "forecast")).toBeNull();
    });
  });

  it("reads a row in an old shape as nothing rather than as wrong numbers", async () => {
    await inRolledBackDb(async (db) => {
      const place = placeKey(40.7, -73.9);
      await saveWeather(
        db,
        place,
        "observed",
        // An older shape, as a past version might have saved it.
        { stationId: "KNYC" } as never,
        edt(13, 10),
      );
      expect(await lastWeather(db, place, "observed")).toBeNull();
    });
  });
});
