import { afterAll, describe, expect, it } from "vitest";
import { VISITOR } from "@/domain/authz/permissions";
import type { UserId } from "@/domain/ids";
import { user } from "../schema/auth";
import { league } from "../schema/league";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { closePool, inRolledBackDb } from "../test/transaction";
import type { Db } from "./schedule";
import { loadSubject } from "./subject";

afterAll(closePool);

async function world(db: Db) {
  const tag = Math.random().toString(36).slice(2, 8);
  const [lg] = await db
    .insert(league)
    .values({ name: "Test League", slug: `test-${tag}` })
    .returning({ id: league.id });
  const [sn] = await db
    .insert(season)
    .values({
      leagueId: lg!.id,
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
  const entry = async (slug: string) => {
    const [t] = await db
      .insert(team)
      .values({ leagueId: lg!.id, name: slug, slug })
      .returning({ id: team.id });
    const [e] = await db
      .insert(teamSeason)
      .values({ teamId: t!.id, seasonId: sn!.id })
      .returning({ id: teamSeason.id });
    return e!.id;
  };
  const person = async (
    name: string,
    globalRole: "player" | "admin" | "owner" = "player",
  ) => {
    const [u] = await db
      .insert(user)
      .values({ name, email: `db-test-${tag}-${name}@example.test` })
      .returning({ id: user.id });
    await db
      .insert(profile)
      .values({ userId: u!.id, globalRole })
      .onConflictDoUpdate({ target: profile.userId, set: { globalRole } });
    return u!.id;
  };
  const join = async (
    userId: UserId,
    teamSeasonId: string,
    role: "captain" | "co_captain" | "player",
    status: "invited" | "active" | "removed" = "active",
  ) => {
    const [r] = await db
      .insert(registration)
      .values({ seasonId: sn!.id, userId, kind: "team_member" })
      .returning({ id: registration.id });
    await db.insert(rosterMembership).values({
      teamSeasonId: teamSeasonId as never,
      registrationId: r!.id,
      role,
      status,
    });
  };
  return { entry, person, join };
}

describe("loadSubject", () => {
  it("is a visitor without a user, or for someone with no profile", () =>
    inRolledBackDb(async (db) => {
      expect(await loadSubject(db, null)).toEqual(VISITOR);
      expect(
        await loadSubject(db, "00000000-0000-4000-8000-000000000000" as UserId),
      ).toEqual(VISITOR);
    }));

  it("carries the global role and active roster roles only", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const teamA = await w.entry("big-kicks");
      const captain = await w.person("cap");
      await w.join(captain, teamA, "captain");
      const invited = await w.person("new");
      await w.join(invited, teamA, "player", "invited");
      const admin = await w.person("admin", "admin");

      expect(await loadSubject(db, captain)).toEqual({
        ...VISITOR,
        userId: captain,
        globalRole: "player",
        roster: [{ teamSeasonId: teamA, role: "captain" }],
      });
      expect((await loadSubject(db, invited)).roster).toEqual([]);
      expect(await loadSubject(db, admin)).toMatchObject({
        globalRole: "admin",
        roster: [],
      });
    }));
});
