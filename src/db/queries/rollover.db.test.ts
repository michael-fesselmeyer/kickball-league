import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { localDate } from "@/domain/scheduler/slots";
import { localTime } from "@/domain/time/zoned";
import { auditLog } from "../schema/audit";
import { incident, suspension } from "../schema/discipline";
import { division, ruleSet } from "../schema/division";
import { field, game, venue } from "../schema/game";
import { payment, purchase } from "../schema/money";
import { permitWindow } from "../schema/schedule";
import { season } from "../schema/season";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { leagueWorld } from "../test/league-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { rollOver, rolloverSource } from "./rollover";
import type { Db } from "./schedule";

afterAll(closePool);

const NY = "America/New_York";
const NOW = new Date("2027-07-01T16:00:00Z");

/**
 * The export test league (Spring 2027, two teams, a free agent, one cash
 * payment), with a division and its rule set, a co-captain, a registration
 * window and two permit windows, one of them lost.
 */
async function rolloverWorld(db: Db) {
  const w = await leagueWorld(db);
  await db
    .update(season)
    .set({
      registrationOpensAt: new Date("2027-03-01T05:00:00Z"),
      earlyBirdEndsAt: new Date("2027-03-15T03:59:00Z"),
      earlyBirdDiscountCents: 500,
      maxTeams: 10,
      crossoverGames: 2,
    })
    .where(eq(season.id, w.season.id));
  const [rules] = await db
    .insert(ruleSet)
    .values({ leagueId: w.leagueId, name: "Social", innings: 5 })
    .returning({ id: ruleSet.id });
  const [social] = await db
    .insert(division)
    .values({
      seasonId: w.season.id,
      name: "Social",
      slug: "social",
      ruleSetId: rules?.id,
    })
    .returning({ id: division.id });
  await db
    .update(teamSeason)
    .set({ divisionId: social?.id, status: "confirmed" })
    .where(eq(teamSeason.id, w.teamSeasonId));
  // The teammate helps run Kick Bottom.
  await db
    .update(rosterMembership)
    .set({ role: "co_captain" })
    .where(eq(rosterMembership.registrationId, w.teammateRegistration));
  const [v] = await db
    .insert(venue)
    .values({
      leagueId: w.leagueId,
      name: "Example Park",
      slug: "example-park",
    })
    .returning({ id: venue.id });
  if (!v) throw new Error("no venue");
  const [f] = await db
    .insert(field)
    .values({ venueId: v.id, name: "Field 1" })
    .returning({ id: field.id });
  if (!f) throw new Error("no field");
  // Mondays 8 to 10 pm, in daylight saving time.
  await db.insert(permitWindow).values([
    {
      fieldId: f.id,
      seasonId: w.season.id,
      startsAt: new Date("2027-04-06T00:00:00Z"),
      endsAt: new Date("2027-04-06T02:00:00Z"),
      permitNumber: "PK-0001",
      status: "confirmed",
      costCents: 50_000,
    },
    {
      fieldId: f.id,
      seasonId: w.season.id,
      startsAt: new Date("2027-04-13T00:00:00Z"),
      endsAt: new Date("2027-04-13T02:00:00Z"),
      status: "lost",
    },
  ]);
  return { ...w, ruleSetId: rules?.id };
}

const choice = (teamIds: string[]) => ({
  // 2027-04-05 is a Monday; so is 2027-11-01, after the clocks go back.
  name: "Fall 2027",
  startsOn: "2027-11-01",
  teamIds: new Set(teamIds),
});

describe("season rollover", () => {
  it("copies settings, divisions, teams, captains and permit hours, and nothing that starts fresh", async () => {
    await inRolledBackDb(async (db) => {
      const w = await rolloverWorld(db);
      const result = await rollOver(
        db,
        {
          leagueId: w.leagueId,
          slug: "spring-2027",
          choice: choice([w.teamSeasonId, w.otherTeamSeasonId]),
        },
        w.admin,
        NOW,
      );
      expect(result).toEqual({
        ok: true,
        value: { slug: "fall-2027", teams: 2, captains: 3, windows: 1 },
      });

      const [made] = await db
        .select()
        .from(season)
        .where(
          and(eq(season.leagueId, w.leagueId), eq(season.slug, "fall-2027")),
        );
      if (!made) throw new Error("no season");
      expect(made).toMatchObject({
        name: "Fall 2027",
        status: "draft",
        startsOn: "2027-11-01",
        endsOn: "2028-01-24",
        feeModel: "per_player",
        playerFeeCents: 4500,
        freeAgentFeeCents: 4500,
        earlyBirdDiscountCents: 500,
        maxTeams: 10,
        rosterMin: 1,
        rosterMax: 20,
        crossoverGames: 2,
      });
      // Midnight on March 1 (before the clocks go forward) stays midnight
      // 210 days later, in daylight saving time.
      const opens = made.registrationOpensAt;
      if (!opens) throw new Error("no opening");
      expect(localDate(opens, NY)).toBe("2027-09-27");
      expect(localTime(opens, NY)).toBe("00:00");

      const [div] = await db
        .select()
        .from(division)
        .where(eq(division.seasonId, made.id));
      expect(div).toMatchObject({ name: "Social", ruleSetId: w.ruleSetId });

      const entries = await db
        .select({
          name: team.name,
          status: teamSeason.status,
          divisionId: teamSeason.divisionId,
          id: teamSeason.id,
        })
        .from(teamSeason)
        .innerJoin(team, eq(team.id, teamSeason.teamId))
        .where(eq(teamSeason.seasonId, made.id))
        .orderBy(team.name);
      expect(entries.map((e) => [e.name, e.status, e.divisionId])).toEqual([
        ["Base Invaders", "forming", null],
        ["Kick Bottom", "forming", div?.id],
      ]);

      const people = await db
        .select({
          userId: registration.userId,
          status: registration.status,
          waiver: registration.waiverSignatureId,
          role: rosterMembership.role,
        })
        .from(registration)
        .innerJoin(
          rosterMembership,
          eq(rosterMembership.registrationId, registration.id),
        )
        .where(eq(registration.seasonId, made.id));
      expect(
        people
          .map((p) => [p.userId, p.role, p.status, p.waiver])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      ).toEqual(
        [
          [w.captain, "captain", "pending_waiver", null],
          [w.teammate, "co_captain", "pending_waiver", null],
          [w.otherCaptain, "captain", "pending_waiver", null],
        ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      );
      // The free agent and every payment stay with the old season.
      const regs = await db
        .select({ userId: registration.userId })
        .from(registration)
        .where(eq(registration.seasonId, made.id));
      expect(regs.map((r) => r.userId)).not.toContain(w.agent);
      const paid = await db
        .select({ id: payment.id })
        .from(payment)
        .innerJoin(purchase, eq(purchase.id, payment.purchaseId))
        .where(eq(purchase.seasonId, made.id));
      expect(paid).toEqual([]);

      // The lost window is not asked for again; the other keeps 8 to 10 pm.
      const windows = await db
        .select()
        .from(permitWindow)
        .where(eq(permitWindow.seasonId, made.id));
      expect(windows).toHaveLength(1);
      const [win] = windows;
      if (!win) throw new Error("no window");
      expect(localDate(win.startsAt, NY)).toBe("2027-11-01");
      expect(localTime(win.startsAt, NY)).toBe("20:00");
      expect(localTime(win.endsAt, NY)).toBe("22:00");
      expect(win).toMatchObject({
        status: "requested",
        permitNumber: null,
        costCents: null,
        documentFileId: null,
      });

      const [audit] = await db
        .select({ before: auditLog.before, after: auditLog.after })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "season.rollover"),
            eq(auditLog.entityId, made.id),
          ),
        );
      expect(audit?.before).toEqual({
        fromSeasonId: w.season.id,
        fromSlug: "spring-2027",
      });
      expect(audit?.after).toMatchObject({ teams: 2, captains: 3 });
    });
  });

  it("brings only the chosen teams and refuses a name already used", async () => {
    await inRolledBackDb(async (db) => {
      const w = await rolloverWorld(db);
      const input = {
        leagueId: w.leagueId,
        slug: "spring-2027",
        choice: choice([w.otherTeamSeasonId]),
      };
      const first = await rollOver(db, input, w.admin, NOW);
      expect(first.ok && first.value.teams).toBe(1);
      expect(await rollOver(db, input, w.admin, NOW)).toEqual({
        ok: false,
        error: "duplicate",
      });
      expect(
        await rollOver(
          db,
          { ...input, choice: { ...input.choice, startsOn: "2027-04-05" } },
          w.admin,
          NOW,
        ),
      ).toEqual({ ok: false, error: "same_dates" });
    });
  });

  it("leaves out a captain suspended for good", async () => {
    await inRolledBackDb(async (db) => {
      const w = await rolloverWorld(db);
      const [played] = await db
        .insert(game)
        .values({
          seasonId: w.season.id,
          teamAId: w.teamSeasonId,
          teamBId: w.otherTeamSeasonId,
        })
        .returning({ id: game.id });
      if (!played) throw new Error("no game");
      const [inc] = await db
        .insert(incident)
        .values({
          gameId: played.id,
          kind: "unsportsmanlike",
          details: "Invented incident for a test",
          reporterRole: "admin",
          reportedBy: w.admin,
        })
        .returning({ id: incident.id });
      if (!inc) throw new Error("no incident");
      await db.insert(suspension).values({
        userId: w.otherCaptain,
        incidentId: inc.id,
        seasonId: w.season.id,
        scope: "permanent",
        issuedBy: w.admin,
        startsAt: new Date("2027-05-01T00:00:00Z"),
      });
      const source = await rolloverSource(db, w.leagueId, "spring-2027", NOW);
      const invaders = source?.teams.find(
        (t) => t.teamSeasonId === w.otherTeamSeasonId,
      );
      expect(invaders?.captains).toEqual([]);
      expect(invaders?.leftOut).toEqual(["Jordan Other"]);

      const result = await rollOver(
        db,
        {
          leagueId: w.leagueId,
          slug: "spring-2027",
          choice: choice([w.otherTeamSeasonId]),
        },
        w.admin,
        NOW,
      );
      expect(result.ok && result.value).toMatchObject({
        teams: 1,
        captains: 0,
      });
      const theirs = await db
        .select({ id: registration.id })
        .from(registration)
        .innerJoin(season, eq(season.id, registration.seasonId))
        .where(
          and(
            eq(registration.userId, w.otherCaptain),
            inArray(season.slug, ["fall-2027"]),
          ),
        );
      expect(theirs).toEqual([]);
    });
  });
});
