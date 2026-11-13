import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { can } from "@/domain/authz/permissions";
import type { TeamSeasonId, UserId } from "@/domain/ids";
import { auditLog } from "../schema/audit";
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
import { waiver, waiverSignature } from "../schema/waiver";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  challengeForSeason,
  challengeStandings,
  confirmChallengeWinner,
  saveChallenge,
  seasonSignups,
} from "./challenges";
import type { Db } from "./schedule";
import { loadSubject } from "./subject";

afterAll(closePool);

const at = (minute: number) => new Date(Date.UTC(2027, 2, 1, 12, minute));
const DEADLINE = at(600);

/**
 * An invented season (roster minimum 3) with three teams: Ants want 3
 * players, Bees set no target, Cats want 4. Players join and sign at the
 * minutes given.
 */
async function world(db: Db) {
  const tag = Math.random().toString(36).slice(2, 8);
  const [lg] = await db
    .insert(league)
    .values({ name: "Drive League", slug: `drive-${tag}` })
    .returning({ id: league.id });
  if (!lg) throw new Error("no league");
  const [spring] = await db
    .insert(season)
    .values({
      leagueId: lg.id,
      name: "Spring 2027",
      slug: `spring-${tag}`,
      status: "registration_open",
      startsOn: "2027-04-01",
      endsOn: "2027-06-30",
      feeModel: "per_player",
      playerFeeCents: 4500,
      freeAgentFeeCents: 4500,
      rosterMin: 3,
      rosterMax: 20,
    })
    .returning({ id: season.id });
  if (!spring) throw new Error("no season");
  const [w] = await db
    .insert(waiver)
    .values({
      leagueId: lg.id,
      version: 1,
      title: "Waiver",
      bodyMd: "Play nice.",
      bodySha256: "0".repeat(64),
    })
    .returning({ id: waiver.id });
  if (!w) throw new Error("no waiver");
  const teams = await db
    .insert(team)
    .values(
      ["Ants", "Bees", "Cats"].map((name) => ({
        leagueId: lg.id,
        name: `${name} ${tag}`,
        slug: `${name.toLowerCase()}-${tag}`,
      })),
    )
    .returning({ id: team.id, name: team.name });
  const entries = await db
    .insert(teamSeason)
    .values(
      teams.map((t, i) => ({
        teamId: t.id,
        seasonId: spring.id,
        targetRosterSize: [3, null, 4][i] ?? null,
      })),
    )
    .returning({ id: teamSeason.id });
  const [ants, bees, cats] = entries.map((e) => e.id);
  if (!ants || !bees || !cats) throw new Error("no teams");
  let n = 0;
  const [admin] = await db
    .insert(user)
    .values({ name: "Ada Admin", email: `drive-admin-${tag}@example.test` })
    .returning({ id: user.id });
  if (!admin) throw new Error("no admin");
  await db.insert(profile).values({ userId: admin.id, globalRole: "admin" });

  /** A player on a team, joined at one minute and signed at another. */
  const player = async (
    teamSeasonId: TeamSeasonId,
    joined: number,
    signed: number | null,
  ): Promise<UserId> => {
    n += 1;
    const [u] = await db
      .insert(user)
      .values({ name: `Player ${n}`, email: `drive-${n}-${tag}@example.test` })
      .returning({ id: user.id });
    if (!u) throw new Error("no user");
    await db.insert(profile).values({ userId: u.id });
    const [sig] =
      signed === null
        ? []
        : await db
            .insert(waiverSignature)
            .values({
              waiverId: w.id,
              userId: u.id,
              seasonId: spring.id,
              signedName: `Player ${n}`,
              signedAt: at(signed),
              bodySha256: "0".repeat(64),
            })
            .returning({ id: waiverSignature.id });
    const [r] = await db
      .insert(registration)
      .values({
        seasonId: spring.id,
        userId: u.id,
        kind: "team_member",
        status: signed === null ? "pending_waiver" : "pending_payment",
        waiverSignatureId: sig?.id ?? null,
      })
      .returning({ id: registration.id });
    if (!r) throw new Error("no registration");
    await db.insert(rosterMembership).values({
      teamSeasonId,
      registrationId: r.id,
      status: "active",
      startedAt: at(joined),
    });
    return u.id;
  };
  return { seasonId: spring.id, admin: admin.id, ants, bees, cats, player };
}

describe("sign-up progress", () => {
  it("reads every team's roster in one go, against its expected size", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      await w.player(w.ants, 1, 2);
      await w.player(w.ants, 3, null);
      await w.player(w.bees, 1, 5);
      const signups = await seasonSignups(db, w.seasonId);
      const by = new Map(signups.map((s) => [s.teamSeasonId, s.progress]));
      expect(by.get(w.ants)).toMatchObject({ signedUp: 1, of: 3 });
      // No target: the season's minimum.
      expect(by.get(w.bees)).toMatchObject({ signedUp: 1, of: 3 });
      expect(by.get(w.cats)).toMatchObject({ signedUp: 0, of: 4 });
    }));
});

describe("the challenge", () => {
  it("starts once per season, can change, and is audited", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const save = (prize: string) =>
        saveChallenge(db, {
          seasonId: w.seasonId,
          challenge: { prize, deadline: DEADLINE },
          actorId: w.admin,
        });
      expect(await save("A pitcher")).toEqual({ ok: true, value: "started" });
      expect(await save("Two pitchers")).toEqual({
        ok: true,
        value: "updated",
      });
      expect((await challengeForSeason(db, w.seasonId))?.prize).toBe(
        "Two pitchers",
      );
      const rows = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.actorId, w.admin));
      expect(rows.map((r) => r.action).sort()).toEqual([
        "challenge.start",
        "challenge.update",
      ]);
    }));

  it("ranks the first full roster on top and confirms it as the winner", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      await saveChallenge(db, {
        seasonId: w.seasonId,
        challenge: { prize: "A pitcher", deadline: DEADLINE },
        actorId: w.admin,
      });
      // Ants and Bees both reach 3 of 3; Bees' last player finished first.
      for (const m of [10, 20, 90]) await w.player(w.ants, m, m + 1);
      for (const m of [10, 20, 60]) await w.player(w.bees, m, m + 1);
      await w.player(w.cats, 5, 6);
      const standings = await challengeStandings(db, {
        seasonId: w.seasonId,
        deadline: DEADLINE,
      });
      expect(standings.map((s) => [s.teamSeasonId, s.rank])).toEqual([
        [w.bees, 1],
        [w.ants, 2],
        [w.cats, 3],
      ]);
      const confirm = (teamSeasonId: TeamSeasonId) =>
        confirmChallengeWinner(db, {
          seasonId: w.seasonId,
          teamSeasonId,
          actorId: w.admin,
          now: at(700),
        });
      expect(await confirm(w.cats)).toEqual({
        ok: false,
        error: "not_complete",
      });
      expect(await confirm(w.ants)).toEqual({ ok: false, error: "not_first" });
      expect(await confirm(w.bees)).toEqual({ ok: true, value: undefined });
      expect(await confirm(w.bees)).toEqual({ ok: false, error: "confirmed" });
      const saved = await challengeForSeason(db, w.seasonId);
      expect(saved).toMatchObject({
        winnerTeamSeasonId: w.bees,
        winnerCompletedAt: at(61),
      });
      const [record] = await db
        .select({ after: auditLog.after })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "challenge.confirm"),
            eq(auditLog.actorId, w.admin),
          ),
        );
      expect(record?.after).toMatchObject({ winner: w.bees });
      // The audit row names teams and counts, never a player.
      expect(JSON.stringify(record?.after)).not.toMatch(/Player/);
      expect(
        await saveChallenge(db, {
          seasonId: w.seasonId,
          challenge: { prize: "Changed", deadline: DEADLINE },
          actorId: w.admin,
        }),
      ).toEqual({ ok: false, error: "confirmed" });
    }));

  it("doesn't count a player who left the roster", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      for (const m of [1, 2, 3]) await w.player(w.ants, m, m);
      const gone = await w.player(w.ants, 4, null);
      await db
        .update(rosterMembership)
        .set({ status: "removed", endedAt: at(5) })
        .where(
          eq(
            rosterMembership.registrationId,
            db
              .select({ id: registration.id })
              .from(registration)
              .where(eq(registration.userId, gone)),
          ),
        );
      const [ants] = (await seasonSignups(db, w.seasonId)).filter(
        (s) => s.teamSeasonId === w.ants,
      );
      expect(ants?.progress).toMatchObject({
        signedUp: 3,
        of: 3,
        percent: 100,
      });
    }));
});

describe("permissions", () => {
  it("shows a team's progress to its players, and leaves the challenge to admins", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const ant = await w.player(w.ants, 1, 2);
      const player = await loadSubject(db, ant);
      const admin = await loadSubject(db, w.admin);
      expect(can(player, "challenge.view_team", { teamSeasonId: w.ants })).toBe(
        true,
      );
      expect(can(player, "challenge.view_team", { teamSeasonId: w.bees })).toBe(
        false,
      );
      expect(can(player, "challenge.view")).toBe(true);
      expect(can(player, "challenge.manage")).toBe(false);
      expect(can(admin, "challenge.manage")).toBe(true);
    }));
});
