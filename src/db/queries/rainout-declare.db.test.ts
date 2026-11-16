import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import type { ScheduleVersionId, SeasonId, UserId } from "@/domain/ids";
import { generate } from "@/domain/scheduler/generate";
import * as schema from "../schema";
import { game, slot } from "../schema/game";
import { scheduleVersion } from "../schema/schedule";
import { removeScheduleWorld, scheduleWorld } from "../test/schedule-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { declareRainout } from "./rainout-declare";
import {
  type Db,
  loadSchedulerInput,
  publishVersion,
  saveVersion,
} from "./schedule";

const clients: Client[] = [];
const connect = async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  clients.push(client);
  return drizzle({ client, schema, casing: "snake_case" });
};
afterAll(async () => {
  await Promise.all(clients.map((c) => c.end()));
  await closePool();
});

/** A published season: five rounds on the world's Sundays. */
async function publishedSeason(db: Db, seasonId: SeasonId, adminId: UserId) {
  const loaded = await loadSchedulerInput(db, seasonId, {
    rounds: 5,
    reservePerDay: 2,
    seed: 7,
  });
  if (!loaded.ok) throw new Error(loaded.error);
  const v1 = await saveVersion(db, {
    seasonId,
    input: loaded.value,
    schedule: generate(loaded.value),
    origin: "generated",
  });
  const published = await publishVersion(db, v1, adminId);
  if (!published.ok) throw new Error(published.error);
  return v1;
}

/** Games the published schedule still has in called-off slots. */
async function gamesInCalledOffSlots(db: Db, seasonId: SeasonId) {
  return db
    .select({ id: game.id })
    .from(game)
    .innerJoin(slot, eq(game.slotId, slot.id))
    .where(and(eq(game.seasonId, seasonId), eq(slot.status, "cancelled")));
}

const parentOf = async (db: Db, id: ScheduleVersionId) =>
  (
    await db
      .select({ parent: scheduleVersion.parentVersionId })
      .from(scheduleVersion)
      .where(eq(scheduleVersion.id, id))
  )[0]?.parent;

describe("two rainy days in one weekend", () => {
  it("builds the second day's draft on the first, so both publish and keep every makeup", () =>
    inRolledBackDb(async (db) => {
      const w = await scheduleWorld(db);
      const [admin] = w.admins;
      const v1 = await publishedSeason(db, w.seasonId, admin);

      const saturday = await declareRainout(db, {
        seasonId: w.seasonId,
        date: "2027-04-11",
        actorId: admin,
      });
      const sunday = await declareRainout(db, {
        seasonId: w.seasonId,
        date: "2027-04-18",
        actorId: admin,
      });
      if (!saturday.ok || !sunday.ok) throw new Error("not declared");
      expect(await parentOf(db, saturday.value)).toBe(v1);
      expect(await parentOf(db, sunday.value)).toBe(saturday.value);

      // Published in order, neither is refused as stale or undoes the other.
      expect((await publishVersion(db, saturday.value, admin)).ok).toBe(true);
      expect((await publishVersion(db, sunday.value, admin)).ok).toBe(true);
      expect(await gamesInCalledOffSlots(db, w.seasonId)).toEqual([]);
    }));

  it("says a day is already rained out, and refuses a day with no games", () =>
    inRolledBackDb(async (db) => {
      const w = await scheduleWorld(db);
      const [admin] = w.admins;
      expect(
        await declareRainout(db, {
          seasonId: w.seasonId,
          date: "2027-04-11",
          actorId: admin,
        }),
      ).toEqual({ ok: false, error: "no_published" });
      await publishedSeason(db, w.seasonId, admin);
      const day = { seasonId: w.seasonId, date: "2027-04-11", actorId: admin };
      expect((await declareRainout(db, day)).ok).toBe(true);
      expect(await declareRainout(db, day)).toEqual({
        ok: false,
        error: "already",
      });
      expect(await declareRainout(db, { ...day, date: "2027-04-12" })).toEqual({
        ok: false,
        error: "no_games",
      });
    }));

  it("chains two days confirmed at the same moment by two people", async () => {
    const setup = await connect();
    const w = await scheduleWorld(setup);
    try {
      const [a, b] = w.admins;
      await publishedSeason(setup, w.seasonId, a);
      const [one, two] = [await connect(), await connect()];
      const [saturday, sunday] = await Promise.all([
        one.transaction((tx) =>
          declareRainout(tx, {
            seasonId: w.seasonId,
            date: "2027-04-11",
            actorId: a,
          }),
        ),
        two.transaction((tx) =>
          declareRainout(tx, {
            seasonId: w.seasonId,
            date: "2027-04-18",
            actorId: b,
          }),
        ),
      ]);
      if (!saturday.ok || !sunday.ok) throw new Error("not declared");
      // Whichever went second built on the first.
      const parents = [
        await parentOf(setup, saturday.value),
        await parentOf(setup, sunday.value),
      ];
      expect(
        parents.includes(saturday.value) || parents.includes(sunday.value),
      ).toBe(true);
      const last = parents.includes(saturday.value)
        ? sunday.value
        : saturday.value;
      expect((await publishVersion(setup, last, a)).ok).toBe(true);
      expect(await gamesInCalledOffSlots(setup, w.seasonId)).toEqual([]);
    } finally {
      await removeScheduleWorld(setup, w);
    }
  });
});
