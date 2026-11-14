import { afterAll, describe, expect, it } from "vitest";
import { can, VISITOR } from "@/domain/authz/permissions";
import {
  type LeagueId,
  parseId,
  type TeamSeasonId,
  type UserId,
} from "@/domain/ids";
import { user } from "../schema/auth";
import { league, leagueMember } from "../schema/league";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { closePool, inRolledBackDb } from "../test/transaction";
import { required } from "./rows";
import type { Db } from "./schedule";
import { loadSubject } from "./subject";

afterAll(closePool);

async function world(db: Db) {
  const tag = Math.random().toString(36).slice(2, 8);
  // Two leagues, as one deployment can run (ADR 0048).
  const [lg, other] = await db
    .insert(league)
    .values([
      { name: "Test League", slug: `test-${tag}` },
      { name: "Other League", slug: `other-${tag}` },
    ])
    .returning({ id: league.id });
  const seasonIn = async (leagueId: LeagueId) => {
    const [sn] = await db
      .insert(season)
      .values({
        leagueId,
        name: "Spring",
        slug: "spring",
        startsOn: "2027-04-04",
        endsOn: "2027-06-06",
        feeModel: "per_team",
        teamFeeCents: 120000,
        rosterMin: 12,
        rosterMax: 20,
      })
      .returning({ id: season.id });
    return sn!.id;
  };
  const seasons = new Map([
    [lg!.id, await seasonIn(lg!.id)],
    [other!.id, await seasonIn(other!.id)],
  ]);
  const entry = async (slug: string, leagueId: LeagueId = lg!.id) => {
    const [t] = await db
      .insert(team)
      .values({ leagueId, name: slug, slug })
      .returning({ id: team.id });
    const [e] = await db
      .insert(teamSeason)
      .values({ teamId: t!.id, seasonId: seasons.get(leagueId)! })
      .returning({ id: teamSeason.id });
    return e!.id;
  };
  const person = async (
    name: string,
    role: "player" | "admin" | "owner" = "player",
    leagueId: LeagueId = lg!.id,
  ) => {
    const [u] = await db
      .insert(user)
      .values({ name, email: `db-test-${tag}-${name}@example.test` })
      .returning({ id: user.id });
    await db.insert(profile).values({ userId: u!.id });
    if (role !== "player")
      await db.insert(leagueMember).values({ leagueId, userId: u!.id, role });
    return u!.id;
  };
  const join = async (
    userId: UserId,
    teamSeasonId: string,
    role: "captain" | "co_captain" | "player",
    status: "invited" | "active" | "removed" = "active",
    leagueId: LeagueId = lg!.id,
  ) => {
    const [r] = await db
      .insert(registration)
      .values({ seasonId: seasons.get(leagueId)!, userId, kind: "team_member" })
      .returning({ id: registration.id });
    await db.insert(rosterMembership).values({
      teamSeasonId: required(parseId<TeamSeasonId>(teamSeasonId), "team"),
      registrationId: r!.id,
      role,
      status,
    });
  };
  return { league: lg!.id, other: other!.id, entry, person, join };
}

describe("loadSubject", () => {
  it("is a visitor without a user, or for someone with no profile", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      expect(await loadSubject(db, null, w.league)).toEqual(VISITOR);
      expect(
        await loadSubject(
          db,
          "00000000-0000-4000-8000-000000000000" as UserId,
          w.league,
        ),
      ).toEqual(VISITOR);
    }));

  it("carries the league's role and its active roster roles only", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const teamA = await w.entry("big-kicks");
      const captain = await w.person("cap");
      await w.join(captain, teamA, "captain");
      const invited = await w.person("new");
      await w.join(invited, teamA, "player", "invited");
      const admin = await w.person("admin", "admin");

      expect(await loadSubject(db, captain, w.league)).toEqual({
        ...VISITOR,
        userId: captain,
        leagueId: w.league,
        globalRole: "player",
        roster: [{ teamSeasonId: teamA, role: "captain" }],
      });
      expect((await loadSubject(db, invited, w.league)).roster).toEqual([]);
      expect(await loadSubject(db, admin, w.league)).toMatchObject({
        leagueId: w.league,
        globalRole: "admin",
        roster: [],
      });
    }));

  it("gives an admin of one league no rights in another (ADR 0048)", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const theirTeam = await w.entry("same-slug", w.other);
      const admin = await w.person("admin", "admin");
      const owner = await w.person("owner", "owner");

      const inOther = await loadSubject(db, admin, w.other);
      expect(inOther).toMatchObject({
        leagueId: w.other,
        globalRole: "player",
      });
      expect(can(inOther, "season.manage")).toBe(false);
      expect(can(inOther, "roster.manage", { teamSeasonId: theirTeam })).toBe(
        false,
      );
      expect(can(await loadSubject(db, owner, w.other), "books.manage")).toBe(
        false,
      );

      // In their own league, a record of the other league is still refused.
      const atHome = await loadSubject(db, admin, w.league);
      expect(can(atHome, "season.manage", { leagueId: w.league })).toBe(true);
      expect(can(atHome, "season.manage", { leagueId: w.other })).toBe(false);
    }));

  it("keeps a player's teams to the league they are loaded for", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const here = await w.entry("here");
      const there = await w.entry("there", w.other);
      const both = await w.person("both");
      await w.join(both, here, "captain");
      await w.join(both, there, "player", "active", w.other);

      expect((await loadSubject(db, both, w.league)).roster).toEqual([
        { teamSeasonId: here, role: "captain" },
      ]);
      expect((await loadSubject(db, both, w.other)).roster).toEqual([
        { teamSeasonId: there, role: "player" },
      ]);
      // A captain at home is no captain of the other league's team.
      expect(
        can(await loadSubject(db, both, w.league), "roster.manage", {
          teamSeasonId: there,
        }),
      ).toBe(false);
    }));
});
