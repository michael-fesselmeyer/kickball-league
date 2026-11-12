import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { countShirts } from "@/domain/shirts/summary";
import { auditLog } from "../schema/audit";
import { leagueWorld } from "../test/league-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { markTeamOrdered, setShirtStatus, shirtBoard } from "./shirts";

afterAll(closePool);

describe("shirt tracking", () => {
  it("groups players by team with their profile size and shirt status", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const board = await shirtBoard(db, w.season.id);
      expect(
        board.teams.map((t) => [t.name, t.players.map((p) => p.size)]),
      ).toEqual([
        ["Base Invaders", ["xl"]],
        ["Kick Bottom", ["l", "m"]],
      ]);
      expect(board.freeAgents.map((p) => [p.name, p.size])).toEqual([
        ["Alex Sample", null],
      ]);
      expect(
        board.teams.flatMap((t) => t.players).every((p) => p.status === "none"),
      ).toBe(true);
    });
  });

  it("marks a shirt received, with an audit row, and counts it", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const result = await setShirtStatus(db, {
        seasonId: w.season.id,
        registrationId: w.teammateRegistration,
        status: "received",
        actorId: w.admin,
      });
      expect(result).toEqual({ ok: true, value: undefined });
      const board = await shirtBoard(db, w.season.id);
      const team = board.teams.find((t) => t.teamSeasonId === w.teamSeasonId);
      expect(countShirts(team?.players ?? [])).toMatchObject({
        total: 2,
        received: 1,
        toOrder: { m: 1, l: 0 },
      });
      const audits = await db
        .select({ before: auditLog.before, after: auditLog.after })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "shirts.set_status"),
            eq(auditLog.entityId, w.teammateRegistration),
          ),
        );
      expect(audits).toEqual([
        { before: { shirtStatus: "none" }, after: { shirtStatus: "received" } },
      ]);
    });
  });

  it("refuses a registration from another season and writes nothing for no change", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const other = await leagueWorld(db);
      expect(
        await setShirtStatus(db, {
          seasonId: w.season.id,
          registrationId: other.teammateRegistration,
          status: "received",
          actorId: w.admin,
        }),
      ).toEqual({ ok: false, error: "unknown_registration" });
      await setShirtStatus(db, {
        seasonId: w.season.id,
        registrationId: w.teammateRegistration,
        status: "none",
        actorId: w.admin,
      });
      const audits = await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "shirts.set_status"),
            inArray(auditLog.entityId, [
              w.teammateRegistration,
              other.teammateRegistration,
            ]),
          ),
        );
      expect(audits).toEqual([]);
    });
  });

  it("marks a team's unordered shirts as ordered and leaves received ones", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      await setShirtStatus(db, {
        seasonId: w.season.id,
        registrationId: w.teammateRegistration,
        status: "received",
        actorId: w.admin,
      });
      const marked = await markTeamOrdered(db, {
        seasonId: w.season.id,
        teamSeasonId: w.teamSeasonId,
        actorId: w.admin,
      });
      expect(marked).toBe(1);
      const board = await shirtBoard(db, w.season.id);
      const team = board.teams.find((t) => t.teamSeasonId === w.teamSeasonId);
      expect(team?.players.map((p) => [p.name, p.status])).toEqual([
        ['=HYPERLINK("http://example.test") Kicker', "received"],
        ["Robin Example", "ordered"],
      ]);
      // The other team is untouched.
      const other = board.teams.find(
        (t) => t.teamSeasonId === w.otherTeamSeasonId,
      );
      expect(other?.players.map((p) => p.status)).toEqual(["none"]);
    });
  });
});
