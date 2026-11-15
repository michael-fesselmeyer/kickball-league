import { and, eq, lt } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { auditLog } from "../schema/audit";
import { leagueWorld } from "../test/league-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { auditLogPage } from "./audit";
import {
  duePurges,
  PURGE_FAILED,
  PURGED,
  recordFailedPurges,
  recordRetriedPurges,
} from "./photo-purges";
import type { Db } from "./schedule";

afterAll(closePool);

const A = "/media/photos/0b6f3c1e-2d4a-4f5b-8c9d-1e2f3a4b5c6d";
const B = "/media/merch/7a8b9c0d-1e2f-4a3b-9c5d-6e7f8a9b0c1d";
const MONTH = 31 * 24 * 60 * 60;
const DAY = 24 * 60 * 60 * 1000;

/** Moves this address's rows of one action to a known time. */
async function stamp(db: Db, src: string, action: string, at: Date) {
  await db
    .update(auditLog)
    .set({ occurredAt: at })
    .where(
      and(
        eq(auditLog.action, action),
        eq(auditLog.entityId, src.slice(src.lastIndexOf("/") + 1)),
      ),
    );
}

describe("failed photo purges", () => {
  it("stay due until a later retry clears them, in the photo's league's audit log", () =>
    inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const now = new Date(Date.UTC(2099, 0, 31));
      await recordFailedPurges(db, [
        { src: A, leagueId: w.leagueId },
        { src: B, leagueId: w.leagueId },
      ]);
      await stamp(db, A, PURGE_FAILED, new Date(now.getTime() - DAY));
      await stamp(db, B, PURGE_FAILED, new Date(now.getTime() - DAY));
      expect(await duePurges(db, now, MONTH)).toEqual([
        { src: B, leagueId: w.leagueId },
        { src: A, leagueId: w.leagueId },
      ]);

      // Admins see it in the league's audit log, with no actor.
      const log = await auditLogPage(db, w.leagueId, { limit: 5 });
      const failed = log.rows.filter((r) => r.action === PURGE_FAILED);
      expect(failed.map((r) => r.actorEmail)).toEqual([null, null]);
      expect(failed.map((r) => r.after)).toEqual(
        expect.arrayContaining([{ src: A }, { src: B }]),
      );

      await recordRetriedPurges(db, [{ src: A, leagueId: w.leagueId }]);
      await stamp(db, A, PURGED, now);
      expect(await duePurges(db, now, MONTH)).toEqual([
        { src: B, leagueId: w.leagueId },
      ]);

      // Failing again after the retry makes it due again.
      await recordFailedPurges(db, [{ src: A, leagueId: w.leagueId }]);
      // Only the new row: the first is already stamped in 2099.
      await db
        .update(auditLog)
        .set({ occurredAt: new Date(now.getTime() + 1000) })
        .where(
          and(
            eq(auditLog.action, PURGE_FAILED),
            lt(auditLog.occurredAt, new Date(Date.UTC(2099, 0, 1))),
          ),
        );
      expect((await duePurges(db, now, MONTH)).map((p) => p.src)).toEqual([
        B,
        A,
      ]);
    }));

  it("stop being due once the optimizer's copies have expired", () =>
    inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const now = new Date(Date.UTC(2099, 0, 31));
      await recordFailedPurges(db, [{ src: A, leagueId: w.leagueId }]);
      await stamp(db, A, PURGE_FAILED, new Date(now.getTime() - 32 * DAY));
      expect(await duePurges(db, now, MONTH)).toEqual([]);
    }));

  it("record nothing for an empty list", () =>
    inRolledBackDb(async (db) => {
      const count = async () => (await db.select().from(auditLog)).length;
      const before = await count();
      await recordFailedPurges(db, []);
      await recordRetriedPurges(db, []);
      expect(await count()).toBe(before);
    }));
});
