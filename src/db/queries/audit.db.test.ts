import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { auditLog } from "../schema/audit";
import { leagueWorld } from "../test/league-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { auditLogPage, recordAudit } from "./audit";

afterAll(closePool);

describe("auditLogPage", () => {
  it("pages newest first, names the actor and filters operator actions", () =>
    inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const entityId = w.season.id;
      // Far-future times, so these rows sort above anything else in the database.
      const at = (minute: number) => new Date(Date.UTC(2099, 0, 1, 0, minute));
      for (const [minute, action] of [
        [1, "season.update"],
        [2, "operator.site_status"],
        [3, "schedule.publish"],
      ] as const) {
        await recordAudit(db, {
          actorId: w.admin,
          action,
          entityType: "season",
          entityId,
          before: { status: "active" },
          after: { status: "paused" },
        });
        // recordAudit stamps the time itself; move it to a known minute.
        await db
          .update(auditLog)
          .set({ occurredAt: at(minute) })
          .where(
            and(eq(auditLog.action, action), eq(auditLog.entityId, entityId)),
          );
      }

      const first = await auditLogPage(db, { limit: 2 });
      expect(first.rows.map((r) => r.action)).toEqual([
        "schedule.publish",
        "operator.site_status",
      ]);
      expect(first.more).toBe(true);
      expect(first.rows[0]?.actorEmail).toBe(w.emails[3]);

      const next = await auditLogPage(db, {
        limit: 2,
        before: first.rows.at(-1)!.occurredAt,
      });
      expect(next.rows[0]?.action).toBe("season.update");

      const operator = await auditLogPage(db, { operatorOnly: true });
      expect(operator.rows.every((r) => r.action.startsWith("operator."))).toBe(
        true,
      );
      expect(operator.rows.map((r) => r.action)).toContain(
        "operator.site_status",
      );
    }));
});
