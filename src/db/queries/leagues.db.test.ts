import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { UserId } from "@/domain/ids";
import { DEFAULT_LEAGUE_SEGMENT } from "@/domain/league/paths";
import { auditLog } from "../schema/audit";
import { user } from "../schema/auth";
import { creditEntry } from "../schema/credit";
import { ruleSet } from "../schema/division";
import { league } from "../schema/league";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import { leagueWorld } from "../test/league-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { recordAudit } from "./audit";
import { creditBalance } from "./credit";
import { leaguesOfRecords } from "./league-of";
import {
  allLeagues,
  createLeague,
  defaultLeague,
  leagueBySegment,
  leagueBySlug,
  leagueRoleOf,
  leaguesOf,
  setLeagueRole,
} from "./leagues";
import { teamBySlug } from "./public-schedule";
import type { Db } from "./schedule";
import { seasonBySlug } from "./schedule-screen";
import { publicSeasons } from "./sitemap";

afterAll(closePool);

const FOOTBALL = {
  name: "Sunday Flag Football",
  sport: "football" as const,
  timeZone: "America/Chicago",
  minimumAge: 21,
  primaryColor: "#14532D",
  secondaryColor: "#F5B301",
  ruleSet: { name: "Standard", innings: null, timeLimitMinutes: 50 },
};

/** The kickball world, plus a second league whose season and team share its slugs. */
async function twoLeagues(db: Db) {
  const w = await leagueWorld(db);
  const tag = Math.random().toString(36).slice(2, 8);
  const created = await createLeague(db, {
    ...FOOTBALL,
    slug: `football-${tag}`,
    actorId: w.admin,
  });
  if (!created.ok) throw new Error(created.error);
  const football = created.value;
  const [kickTeam] = await db
    .select({ slug: team.slug })
    .from(team)
    .where(eq(team.leagueId, w.leagueId))
    .limit(1);
  const [fallSeason] = await db
    .insert(season)
    .values({
      leagueId: football,
      name: "Spring 2027",
      slug: w.season.slug,
      status: "in_progress",
      startsOn: "2027-04-05",
      endsOn: "2027-06-28",
      feeModel: "per_player",
      playerFeeCents: 6000,
      rosterMin: 1,
      rosterMax: 12,
    })
    .returning({ id: season.id });
  const [footballTeam] = await db
    .insert(team)
    .values({ leagueId: football, name: "Same name", slug: kickTeam!.slug })
    .returning({ id: team.id });
  await db
    .insert(teamSeason)
    .values({ teamId: footballTeam!.id, seasonId: fallSeason!.id });
  return {
    ...w,
    football,
    footballSeason: fallSeason!.id,
    footballTeam: footballTeam!.id,
    sharedTeamSlug: kickTeam!.slug,
  };
}

async function person(db: Db, name: string): Promise<UserId> {
  const [u] = await db
    .insert(user)
    .values({ name, email: `${name}-${Math.random()}@example.test` })
    .returning({ id: user.id });
  await db.insert(profile).values({ userId: u!.id });
  return u!.id;
}

describe("creating a league", () => {
  it("adds the league, its first rule set and an audit row in that league", () =>
    inRolledBackDb(async (db) => {
      const w = await twoLeagues(db);
      const found = await leagueBySlug(
        db,
        (await allLeagues(db)).find((l) => l.id === w.football)!.slug,
      );
      expect(found).toMatchObject({
        name: FOOTBALL.name,
        sport: "football",
        timeZone: "America/Chicago",
        minimumAge: 21,
        branding: { primaryColor: "#14532D", secondaryColor: "#F5B301" },
      });
      const rules = await db
        .select({ name: ruleSet.name, minutes: ruleSet.timeLimitMinutes })
        .from(ruleSet)
        .where(eq(ruleSet.leagueId, w.football));
      expect(rules).toEqual([{ name: "Standard", minutes: 50 }]);
      const audit = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.leagueId, w.football));
      expect(audit.map((a) => a.action)).toContain("operator.league_create");
    }));

  it("refuses an address another league already uses", () =>
    inRolledBackDb(async (db) => {
      const w = await twoLeagues(db);
      const slug = (await allLeagues(db)).find(
        (l) => l.id === w.football,
      )!.slug;
      expect(
        await createLeague(db, { ...FOOTBALL, slug, actorId: w.admin }),
      ).toEqual({ ok: false, error: "slug_taken" });
    }));
});

describe("the default league", () => {
  it("is the one marked, and the _default segment finds it", () =>
    inRolledBackDb(async (db) => {
      const w = await twoLeagues(db);
      await db.update(league).set({ isDefault: false });
      await db
        .update(league)
        .set({ isDefault: true })
        .where(eq(league.id, w.leagueId));
      expect((await defaultLeague(db))?.id).toBe(w.leagueId);
      expect((await leagueBySegment(db, DEFAULT_LEAGUE_SEGMENT))?.id).toBe(
        w.leagueId,
      );
      const football = await leagueBySegment(
        db,
        (await allLeagues(db)).find((l) => l.id === w.football)!.slug,
      );
      expect(football).toMatchObject({ id: w.football, isDefault: false });
      expect((await allLeagues(db))[0]?.id).toBe(w.leagueId);
    }));
});

describe("belonging to leagues", () => {
  it("lists the leagues a person plays in or has a role in, and the role per league", () =>
    inRolledBackDb(async (db) => {
      const w = await twoLeagues(db);
      const fran = await person(db, "fran");
      expect(await leaguesOf(db, fran)).toEqual([]);
      await setLeagueRole(db, {
        leagueId: w.football,
        userId: fran,
        role: "admin",
        actorId: w.admin,
      });
      expect((await leaguesOf(db, fran)).map((l) => l.id)).toEqual([
        w.football,
      ]);
      expect(await leagueRoleOf(db, fran, w.football)).toBe("admin");
      expect(await leagueRoleOf(db, fran, w.leagueId)).toBe("player");
      // The kickball captain plays there only.
      expect((await leaguesOf(db, w.captain)).map((l) => l.id)).toEqual([
        w.leagueId,
      ]);
    }));
});

describe("the audit log", () => {
  it("files an entry in the league of the record it is about", () =>
    inRolledBackDb(async (db) => {
      const w = await twoLeagues(db);
      await recordAudit(db, {
        actorId: w.admin,
        action: "season.update",
        entityType: "season",
        entityId: w.footballSeason,
      });
      const [row] = await db
        .select({ leagueId: auditLog.leagueId })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entityId, w.footballSeason),
            eq(auditLog.action, "season.update"),
          ),
        );
      expect(row?.leagueId).toBe(w.football);
    }));

  it("refuses an entry about a person without a league", () =>
    inRolledBackDb(async (db) => {
      const w = await twoLeagues(db);
      await expect(
        recordAudit(
          db,
          // What a caller that forgot the league would send, past the types.
          JSON.parse(
            JSON.stringify({
              actorId: w.admin,
              action: "account.merge",
              entityType: "user",
              entityId: w.captain,
            }),
          ),
        ),
      ).rejects.toThrow(/needs its league/);
    }));
});

describe("records and their leagues", () => {
  it("finds the league of each kind of record, and null for one that doesn't exist", () =>
    inRolledBackDb(async (db) => {
      const w = await twoLeagues(db);
      expect(
        await leaguesOfRecords(db, [
          { kind: "season", id: w.season.id },
          { kind: "season", id: w.footballSeason },
          { kind: "team", id: w.footballTeam },
          { kind: "team_season", id: w.teamSeasonId },
          { kind: "season", id: "00000000-0000-4000-8000-000000000000" },
          { kind: "season", id: "not-an-id" },
        ]),
      ).toEqual([w.leagueId, w.football, w.football, w.leagueId, null, null]);
    }));
});

describe("lookups by slug stay in their league", () => {
  it("finds each league's own season and team when the slugs are the same", () =>
    inRolledBackDb(async (db) => {
      const w = await twoLeagues(db);
      expect((await seasonBySlug(db, w.leagueId, w.season.slug))?.id).toBe(
        w.season.id,
      );
      expect((await seasonBySlug(db, w.football, w.season.slug))?.id).toBe(
        w.footballSeason,
      );
      expect(await seasonBySlug(db, null, w.season.slug)).toBeNull();
      expect((await teamBySlug(db, w.football, w.sharedTeamSlug))?.id).toBe(
        w.footballTeam,
      );
      expect((await teamBySlug(db, w.leagueId, w.sharedTeamSlug))?.id).not.toBe(
        w.footballTeam,
      );
      expect((await publicSeasons(db, w.football)).map((s) => s.slug)).toEqual([
        w.season.slug,
      ]);
    }));

  it("keeps league credit to the league that gave it", () =>
    inRolledBackDb(async (db) => {
      const w = await twoLeagues(db);
      await db.insert(creditEntry).values({
        userId: w.captain,
        leagueId: w.football,
        deltaCents: 1500,
        reason: "goodwill",
        note: "Rained out",
      });
      expect(await creditBalance(db, w.captain, w.football)).toBe(1500);
      expect(await creditBalance(db, w.captain, w.leagueId)).toBe(0);
    }));
});
