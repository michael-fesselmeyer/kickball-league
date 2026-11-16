import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import type { ScheduleVersionId } from "@/domain/ids";
import { generate } from "@/domain/scheduler/generate";
import * as schema from "../schema";
import { scheduleVersion } from "../schema/schedule";
import { removeScheduleWorld, scheduleWorld } from "../test/schedule-world";
import { loadSchedulerInput, publishVersion, saveVersion } from "./schedule";

/**
 * Two admins publishing at the same moment, on separate connections, so
 * the transactions really overlap (a rolled-back test transaction can't).
 * Each test commits its own league and deletes it afterwards.
 */

const clients: Client[] = [];
const connect = async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  clients.push(client);
  return drizzle({ client, schema, casing: "snake_case" });
};
afterAll(() => Promise.all(clients.map((c) => c.end())));

const options = { rounds: 7, reservePerDay: 2, seed: 7 };

describe("two admins publishing at the same moment", () => {
  it("publishes one draft after the other, never two at once and never an error", async () => {
    const setup = await connect();
    const w = await scheduleWorld(setup);
    try {
      const loaded = await loadSchedulerInput(setup, w.seasonId, options);
      if (!loaded.ok) throw new Error(loaded.error);
      const draft = (seed: number) =>
        saveVersion(setup, {
          seasonId: w.seasonId,
          input: loaded.value,
          schedule: generate({ ...loaded.value, seed }),
          origin: "generated",
        });
      // A published schedule, then two new drafts, one per admin.
      const first = await draft(1);
      expect((await publishVersion(setup, first, w.admins[0])).ok).toBe(true);
      const mine = await draft(2);
      const theirs = await draft(3);

      const [one, two] = [await connect(), await connect()];
      const results = await Promise.allSettled([
        publishVersion(one, mine, w.admins[0]),
        publishVersion(two, theirs, w.admins[1]),
      ]);
      // Neither admin sees a crash: each publish finishes on its own terms.
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
      const published = await setup
        .select({ id: scheduleVersion.id })
        .from(scheduleVersion)
        .where(
          and(
            eq(scheduleVersion.seasonId, w.seasonId),
            eq(scheduleVersion.status, "published"),
          ),
        );
      expect(published).toHaveLength(1);
    } finally {
      await removeScheduleWorld(setup, w);
    }
  });

  it("refuses a draft made before another version was published, so it can't undo it", async () => {
    const setup = await connect();
    const w = await scheduleWorld(setup);
    try {
      const loaded = await loadSchedulerInput(setup, w.seasonId, options);
      if (!loaded.ok) throw new Error(loaded.error);
      const save = (seed: number, parent?: ScheduleVersionId) =>
        saveVersion(setup, {
          seasonId: w.seasonId,
          input: loaded.value,
          schedule: generate({ ...loaded.value, seed }),
          origin: "generated",
          ...(parent ? { parentVersionId: parent } : {}),
        });
      const first = await save(1);
      expect((await publishVersion(setup, first, w.admins[0])).ok).toBe(true);
      // Two admins each start a draft from the published schedule (one a
      // rain-out's makeups, say); the first is published.
      const rainout = await save(2, first);
      const edit = await save(3, first);
      expect((await publishVersion(setup, rainout, w.admins[0])).ok).toBe(true);
      // The other draft was made without it: publishing it would undo it.
      expect(await publishVersion(setup, edit, w.admins[1])).toEqual({
        ok: false,
        error: "stale",
      });
      // A draft made from the new schedule, or from a draft of it, is fine.
      const next = await save(4, rainout);
      const nextEdit = await save(5, next);
      expect((await publishVersion(setup, nextEdit, w.admins[1])).ok).toBe(
        true,
      );
    } finally {
      await removeScheduleWorld(setup, w);
    }
  });
});
