import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { UserId } from "@/domain/ids";
import { user } from "../schema/auth";
import { league } from "../schema/league";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { invite, registration } from "../schema/team";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  acceptInvite,
  createTeamInvite,
  inviteByToken,
  openTeamInvite,
  rosterBoard,
} from "./invites";
import {
  myRegistration,
  registerFreeAgent,
  registerTeam,
  type SeasonForRegistration,
  seasonForRegistration,
} from "./registration";
import type { Db } from "./schedule";

afterAll(closePool);

const NOW = new Date("2027-02-15T17:00:00Z");

async function world(db: Db, rosterMax = 20) {
  const tag = Math.random().toString(36).slice(2, 8);
  const names = ["Robin", "Sam", "Alex", "Jo"];
  const people = await db
    .insert(user)
    .values(
      names.map((n) => ({ name: n, email: `inv-${n}-${tag}@example.test` })),
    )
    .returning({ id: user.id });
  await db.insert(profile).values(
    people.map((p, i) => ({
      userId: p.id,
      firstName: names[i],
      lastName: "Example",
    })),
  );
  const [lg] = await db
    .insert(league)
    .values({ name: "Test League", slug: `inv-${tag}` })
    .returning({ id: league.id });
  await db.insert(season).values({
    leagueId: lg!.id,
    name: "Spring",
    slug: "spring",
    status: "registration_open",
    startsOn: "2027-04-05",
    endsOn: "2027-06-28",
    feeModel: "per_team",
    teamFeeCents: 120_000,
    freeAgentFeeCents: 9000,
    rosterMin: 1,
    rosterMax,
  });
  const leagueId = lg!.id;
  const s = (await seasonForRegistration(
    db,
    leagueId,
    "spring",
  )) as SeasonForRegistration;
  const ids = people.map((p) => p.id);
  const team = async (captain: UserId, name: string) => {
    const r = await registerTeam(db, {
      ageConfirmed: true,
      leagueId,
      season: s,
      userId: captain,
      team: {
        teamId: null,
        name,
        colorHex: null,
        paymentMode: "split",
        rosterSize: 2,
      },
      now: NOW,
    });
    if (!r.ok) throw new Error(r.error);
    return r.value.teamSeasonId;
  };
  return { leagueId, season: s, ids, team };
}

describe("invites", () => {
  it("lets a player join through the captain's link and shows them on the board", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const [captain, player] = w.ids as [UserId, UserId];
      const teamSeasonId = await w.team(captain, "Kick Bottom");
      expect(await openTeamInvite(db, teamSeasonId, NOW)).toBeNull();
      const { token } = await createTeamInvite(db, {
        teamSeasonId,
        actorId: captain,
        now: NOW,
      });
      expect(await openTeamInvite(db, teamSeasonId, NOW)).not.toBeNull();
      // Only the hash is stored.
      const stored = await db
        .select({ tokenHash: invite.tokenHash })
        .from(invite)
        .where(eq(invite.teamSeasonId, teamSeasonId));
      expect(stored.map((r) => r.tokenHash)).not.toContain(token);

      expect(await inviteByToken(db, token, NOW)).toMatchObject({
        state: "open",
        teamName: "Kick Bottom",
        shareCents: 60_000,
        members: 1,
      });
      expect(
        await acceptInvite(db, {
          ageConfirmed: true,
          token,
          userId: player,
          now: NOW,
        }),
      ).toEqual({
        ok: true,
        value: { seasonSlug: "spring", teamName: "Kick Bottom" },
      });
      expect(
        await acceptInvite(db, {
          ageConfirmed: true,
          token,
          userId: player,
          now: NOW,
        }),
      ).toEqual({
        ok: false,
        error: "already_member",
      });
      expect(await myRegistration(db, w.season.id, player)).toMatchObject({
        kind: "team_member",
        status: "pending_waiver",
        team: { role: "player", teamName: "Kick Bottom", shareCents: 60_000 },
      });
      const board = await rosterBoard(db, teamSeasonId);
      expect(board.map((m) => [m.name, m.role, m.signed, m.paid])).toEqual([
        ["Robin Example", "captain", false, false],
        ["Sam Example", "player", false, false],
      ]);
    });
  });

  it("revokes the old link when a new one is made, and refuses bad or expired links", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const [captain, player] = w.ids as [UserId, UserId];
      const teamSeasonId = await w.team(captain, "Kick Bottom");
      const first = await createTeamInvite(db, {
        teamSeasonId,
        actorId: captain,
        now: NOW,
      });
      const second = await createTeamInvite(db, {
        teamSeasonId,
        actorId: captain,
        now: NOW,
      });
      expect(
        await acceptInvite(db, {
          ageConfirmed: true,
          token: first.token,
          userId: player,
          now: NOW,
        }),
      ).toEqual({
        ok: false,
        error: "revoked",
      });
      const later = new Date(NOW.getTime() + 31 * 86_400_000);
      expect((await inviteByToken(db, second.token, later))?.state).toBe(
        "expired",
      );
      expect(
        await acceptInvite(db, {
          ageConfirmed: true,
          token: second.token,
          userId: player,
          now: later,
        }),
      ).toEqual({
        ok: false,
        error: "expired",
      });
      expect(
        await acceptInvite(db, {
          ageConfirmed: true,
          token: "not-a-token",
          userId: player,
          now: NOW,
        }),
      ).toEqual({
        ok: false,
        error: "invalid",
      });
      expect(await inviteByToken(db, "x".repeat(43), NOW)).toBeNull();
      await db
        .update(season)
        .set({ status: "registration_closed" })
        .where(eq(season.id, w.season.id));
      expect(
        await acceptInvite(db, {
          ageConfirmed: true,
          token: second.token,
          userId: player,
          now: NOW,
        }),
      ).toEqual({
        ok: false,
        error: "closed",
      });
    });
  });

  it("stops at the roster limit and keeps players on one team", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db, 2);
      const [a, b, c, d] = w.ids as [UserId, UserId, UserId, UserId];
      const one = await w.team(a, "One");
      const two = await w.team(b, "Two");
      const link = await createTeamInvite(db, {
        teamSeasonId: one,
        actorId: a,
        now: NOW,
      });
      // A free agent joining keeps their registration and becomes a team member.
      await registerFreeAgent(db, {
        ageConfirmed: true,
        season: w.season,
        userId: c,
        now: NOW,
      });
      expect(
        (
          await acceptInvite(db, {
            ageConfirmed: true,
            token: link.token,
            userId: c,
            now: NOW,
          })
        ).ok,
      ).toBe(true);
      const [cReg] = await db
        .select({ kind: registration.kind })
        .from(registration)
        .where(eq(registration.userId, c));
      expect(cReg?.kind).toBe("team_member");
      expect(
        await acceptInvite(db, {
          ageConfirmed: true,
          token: link.token,
          userId: d,
          now: NOW,
        }),
      ).toEqual({
        ok: false,
        error: "full",
      });
      const other = await createTeamInvite(db, {
        teamSeasonId: two,
        actorId: b,
        now: NOW,
      });
      expect(
        await acceptInvite(db, {
          ageConfirmed: true,
          token: other.token,
          userId: c,
          now: NOW,
        }),
      ).toEqual({
        ok: false,
        error: "on_another_team",
      });
    });
  });
});
