import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { auditLog } from "../schema/audit";
import { profile } from "../schema/profile";
import { leagueWorld } from "../test/league-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  leagueExport,
  setFeature,
  setGlobalRole,
  setSiteStatus,
  staff,
} from "./platform";
import type { Db } from "./schedule";

afterAll(closePool);

/** The world's league; a shared test database may hold others. */
const worldSite = async (
  _db: Db,
  w: Awaited<ReturnType<typeof leagueWorld>>,
) => ({
  leagueId: w.leagueId,
});

const auditFor = (db: Db, entityId: string, action: string) =>
  db
    .select({
      actorId: auditLog.actorId,
      before: auditLog.before,
      after: auditLog.after,
    })
    .from(auditLog)
    .where(and(eq(auditLog.entityId, entityId), eq(auditLog.action, action)));

describe("operator settings", () => {
  it("sets the site status and records who changed it", () =>
    inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const site = await worldSite(db, w);
      await setSiteStatus(db, {
        leagueId: site.leagueId,
        status: "paused",
        actorId: w.admin,
      });
      const audit = await auditFor(db, site.leagueId, "operator.site_status");
      expect(audit).toEqual([
        {
          actorId: w.admin,
          before: { status: "active" },
          after: { status: "paused" },
        },
      ]);
    }));

  it("switches a feature off and on again without duplicates", () =>
    inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const { leagueId } = await worldSite(db, w);
      const off = {
        leagueId,
        feature: "subs" as const,
        on: false,
        actorId: w.admin,
      };
      await setFeature(db, off);
      await setFeature(db, off);
      await setFeature(db, { ...off, feature: "weather" });
      const audit = await auditFor(db, leagueId, "operator.feature");
      expect(audit.at(-1)?.after).toEqual({ disabled: ["subs", "weather"] });
      await setFeature(db, { ...off, on: true });
      const after = await auditFor(db, leagueId, "operator.feature");
      expect(after.at(-1)?.after).toEqual({ disabled: ["weather"] });
    }));

  it("gives a person a role by email, with an audit row, and reports unknown emails", () =>
    inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const result = await setGlobalRole(db, {
        email: w.emails[1]!.toUpperCase(),
        role: "owner",
        actorId: w.admin,
      });
      expect(result).toEqual({
        ok: true,
        value: { userId: w.teammate, before: "player" },
      });
      const [row] = await db
        .select({ role: profile.globalRole })
        .from(profile)
        .where(eq(profile.userId, w.teammate));
      expect(row?.role).toBe("owner");
      expect(await staff(db)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ userId: w.teammate, role: "owner" }),
          expect.objectContaining({ userId: w.admin, role: "admin" }),
        ]),
      );
      expect(await auditFor(db, w.teammate, "operator.role")).toHaveLength(1);
      expect(
        await setGlobalRole(db, {
          email: "nobody@example.test",
          role: "admin",
          actorId: w.admin,
        }),
      ).toEqual({ ok: false, error: "no_account" });
    }));

  it("exports the league's seasons, teams, players and rosters", () =>
    inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const data = await leagueExport(db, w.leagueId);
      expect(data.league?.name).toBe("Test League");
      expect(data.seasons.map((s) => s.id)).toEqual([w.season.id]);
      expect(data.teamSeasons.map((t) => t.id).sort()).toEqual(
        [w.teamSeasonId, w.otherTeamSeasonId].sort(),
      );
      expect(data.players.map((p) => p.email).sort()).toEqual(
        expect.arrayContaining([w.emails[0]]),
      );
      expect(data.rosters.length).toBeGreaterThan(0);
      expect(JSON.stringify(data)).not.toContain("session");
    }));
});
