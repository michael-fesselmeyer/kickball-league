import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { MAX_REQUESTS_PER_TEAM } from "@/domain/schedule/team-requests";
import { auditLog } from "../schema/audit";
import { field, slot, venue } from "../schema/game";
import { league } from "../schema/league";
import { season } from "../schema/season";
import { leagueWorld } from "../test/league-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { loadSchedulerInput } from "./schedule";
import type { Db } from "./schedule";
import {
  addTeamRequest,
  removeTeamRequest,
  seasonGameTimes,
  seasonRequests,
  teamRequests,
} from "./team-requests";

afterAll(closePool);

const conflict = {
  kind: "unavailable" as const,
  onDate: "2027-05-10",
  timeIndex: null,
  reason: "Team trip",
};
const preference = {
  kind: "prefer" as const,
  onDate: null,
  timeIndex: 1,
  reason: null,
};

/** Two evening slots on one field, at 6:30 pm and 7:45 pm New York time. */
async function slots(
  db: Db,
  seasonId: Awaited<ReturnType<typeof leagueWorld>>["season"]["id"],
) {
  const [lg] = await db
    .select({ id: league.id })
    .from(league)
    .innerJoin(season, eq(season.leagueId, league.id))
    .where(eq(season.id, seasonId));
  if (!lg) throw new Error("no league");
  const [v] = await db
    .insert(venue)
    .values({ leagueId: lg.id, name: "Park", slug: "park" })
    .returning({ id: venue.id });
  if (!v) throw new Error("no venue");
  const [f] = await db
    .insert(field)
    .values({ venueId: v.id, name: "Field 1" })
    .returning({ id: field.id });
  if (!f) throw new Error("no field");
  await db.insert(slot).values([
    {
      seasonId,
      fieldId: f.id,
      startsAt: new Date("2027-05-10T23:45:00Z"),
      endsAt: new Date("2027-05-11T00:55:00Z"),
      timeIndex: 1,
    },
    {
      seasonId,
      fieldId: f.id,
      startsAt: new Date("2027-05-10T22:30:00Z"),
      endsAt: new Date("2027-05-10T23:40:00Z"),
      timeIndex: 0,
    },
  ]);
}

describe("team scheduling requests", () => {
  it("saves a team's requests with an audit row and lists them for the team and the season", () =>
    inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const added = await addTeamRequest(db, {
        teamSeasonId: w.teamSeasonId,
        request: conflict,
        actorId: w.captain,
      });
      if (!added.ok) throw new Error(added.error);
      await addTeamRequest(db, {
        teamSeasonId: w.teamSeasonId,
        request: preference,
        actorId: w.captain,
      });
      await addTeamRequest(db, {
        teamSeasonId: w.otherTeamSeasonId,
        request: conflict,
        actorId: w.otherCaptain,
      });

      const mine = await teamRequests(db, w.teamSeasonId);
      expect(mine.map((r) => r.kind).sort()).toEqual(["prefer", "unavailable"]);
      expect(mine.find((r) => r.kind === "unavailable")).toMatchObject(
        conflict,
      );
      const all = await seasonRequests(db, w.season.id);
      expect(all).toHaveLength(3);
      expect(new Set(all.map((r) => r.teamName)).size).toBe(2);

      const audit = await db
        .select({ action: auditLog.action, actorId: auditLog.actorId })
        .from(auditLog)
        .where(eq(auditLog.entityId, added.value));
      expect(audit).toEqual([
        { action: "team_request.add", actorId: w.captain },
      ]);
    }));

  it("feeds the scheduler: conflicts and preferences become its team constraints", () =>
    inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      await addTeamRequest(db, {
        teamSeasonId: w.teamSeasonId,
        request: conflict,
        actorId: w.captain,
      });
      await addTeamRequest(db, {
        teamSeasonId: w.teamSeasonId,
        request: preference,
        actorId: w.captain,
      });
      const input = await loadSchedulerInput(db, w.season.id, {
        rounds: 1,
        reservePerDay: 0,
        seed: 1,
      });
      if (!input.ok) throw new Error(input.error);
      expect(input.value.constraints).toEqual(
        expect.arrayContaining([
          {
            teamId: w.teamSeasonId,
            kind: "unavailable",
            weight: 1,
            date: "2027-05-10",
          },
          { teamId: w.teamSeasonId, kind: "prefer", weight: 1, timeIndex: 1 },
        ]),
      );
    }));

  it("stops a team at the limit", () =>
    inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      for (let i = 0; i < MAX_REQUESTS_PER_TEAM; i++) {
        const day = `2027-05-${String(i + 10).padStart(2, "0")}`;
        const result = await addTeamRequest(db, {
          teamSeasonId: w.teamSeasonId,
          request: { ...conflict, onDate: day },
          actorId: w.captain,
        });
        expect(result.ok).toBe(true);
      }
      expect(
        await addTeamRequest(db, {
          teamSeasonId: w.teamSeasonId,
          request: conflict,
          actorId: w.captain,
        }),
      ).toEqual({ ok: false, error: "too_many" });
    }));

  it("removes only the team's own request, with an audit row", () =>
    inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const added = await addTeamRequest(db, {
        teamSeasonId: w.teamSeasonId,
        request: conflict,
        actorId: w.captain,
      });
      if (!added.ok) throw new Error(added.error);
      expect(
        await removeTeamRequest(db, {
          id: added.value,
          teamSeasonId: w.otherTeamSeasonId,
          actorId: w.otherCaptain,
        }),
      ).toEqual({ ok: false, error: "not_found" });
      expect(
        await removeTeamRequest(db, {
          id: added.value,
          teamSeasonId: w.teamSeasonId,
          actorId: w.captain,
        }),
      ).toEqual({ ok: true, value: undefined });
      expect(await teamRequests(db, w.teamSeasonId)).toEqual([]);
      const removed = await db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entityId, added.value),
            eq(auditLog.action, "team_request.remove"),
          ),
        );
      expect(removed).toHaveLength(1);
    }));

  it("labels the season's game times by their first slot", () =>
    inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      await slots(db, w.season.id);
      expect(
        await seasonGameTimes(db, w.season.id, "America/New_York"),
      ).toEqual([
        { timeIndex: 0, label: "6:30 pm" },
        { timeIndex: 1, label: "7:45 pm" },
      ]);
    }));
});
