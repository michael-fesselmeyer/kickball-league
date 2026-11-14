import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { UserId } from "@/domain/ids";
import { hashWaiverBody } from "@/domain/waiver/waiver";
import { user } from "../schema/auth";
import { league } from "../schema/league";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { rosterMembership, team, teamSeason } from "../schema/team";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  amountOwed,
  myRegistration,
  openSeasons,
  registerFreeAgent,
  registerTeam,
  type SeasonForRegistration,
  seasonForRegistration,
  teamsCaptainedBy,
  type TeamInput,
} from "./registration";
import type { Db } from "./schedule";
import { assignWaiver, publishWaiver, signWaiver } from "./waivers";

afterAll(closePool);

const NOW = new Date("2027-02-15T17:00:00Z");
const BODY = `# Sample\n\n${"Sample text for tests only. ".repeat(10)}`;

async function world(db: Db, change: Partial<typeof season.$inferInsert> = {}) {
  const tag = Math.random().toString(36).slice(2, 8);
  const people = await db
    .insert(user)
    .values(
      ["a", "b", "c"].map((p) => ({
        name: p,
        email: `reg-${p}-${tag}@example.test`,
      })),
    )
    .returning({ id: user.id });
  await db.insert(profile).values(
    people.map((p, i) => ({
      userId: p.id,
      firstName: ["Robin", "Sam", "Alex"][i],
      lastName: "Example",
    })),
  );
  const [lg] = await db
    .insert(league)
    .values({ name: "Test League", slug: `reg-${tag}` })
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
    earlyBirdEndsAt: new Date("2027-03-01T04:59:59Z"),
    earlyBirdDiscountCents: 1000,
    registrationOpensAt: new Date("2027-02-01T05:00:00Z"),
    registrationClosesAt: new Date("2027-03-23T03:59:59Z"),
    maxTeams: 2,
    rosterMin: 12,
    rosterMax: 20,
    ...change,
  });
  const leagueId = lg!.id;
  const s = (await seasonForRegistration(
    db,
    leagueId,
    "spring",
  )) as SeasonForRegistration;
  const [a, b, c] = people.map((p) => p.id) as [UserId, UserId, UserId];
  return { leagueId, season: s, a, b, c };
}

const newTeam = (name: string, change: Partial<TeamInput> = {}): TeamInput => ({
  teamId: null,
  name,
  colorHex: "#E4572E",
  paymentMode: "split",
  rosterSize: 14,
  ...change,
});

describe("registration", () => {
  it("registers a captain's team with a fixed split share", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const result = await registerTeam(db, {
        ageConfirmed: true,
        leagueId: w.leagueId,
        season: w.season,
        userId: w.a,
        team: newTeam("Kick Bottom"),
        now: NOW,
      });
      // $1,190 after the early bird, over 14 players: $85 each.
      expect(result).toMatchObject({ ok: true, value: { shareCents: 8500 } });
      const mine = await myRegistration(db, w.season.id, w.a);
      expect(mine).toMatchObject({
        kind: "team_member",
        status: "pending_waiver",
        team: {
          role: "captain",
          teamName: "Kick Bottom",
          paymentMode: "split",
          shareCents: 8500,
        },
      });
      expect(amountOwed(w.season, mine!, NOW)).toMatchObject({
        ok: true,
        cents: 8500,
      });

      expect(
        await registerTeam(db, {
          ageConfirmed: true,
          leagueId: w.leagueId,
          season: w.season,
          userId: w.a,
          team: newTeam("Again"),
          now: NOW,
        }),
      ).toEqual({ ok: false, error: "already_registered" });
      expect(
        await registerTeam(db, {
          ageConfirmed: true,
          leagueId: w.leagueId,
          season: w.season,
          userId: w.b,
          team: newTeam("kick  bottom"),
          now: NOW,
        }),
      ).toEqual({ ok: false, error: "name_taken" });
      expect(
        await registerTeam(db, {
          ageConfirmed: true,
          leagueId: w.leagueId,
          season: w.season,
          userId: w.b,
          team: newTeam("!!"),
          now: NOW,
        }),
      ).toEqual({ ok: false, error: "bad_name" });
      expect(
        await registerTeam(db, {
          ageConfirmed: true,
          leagueId: w.leagueId,
          season: w.season,
          userId: w.b,
          team: newTeam("Big", { rosterSize: 30 }),
          now: NOW,
        }),
      ).toEqual({ ok: false, error: "bad_roster_size" });
      expect(
        await registerTeam(db, {
          ageConfirmed: true,
          leagueId: w.leagueId,
          season: w.season,
          userId: w.b,
          team: newTeam("Red", { colorHex: "red" }),
          now: NOW,
        }),
      ).toEqual({ ok: false, error: "bad_color" });
      expect(
        await registerTeam(db, {
          ageConfirmed: true,
          leagueId: w.leagueId,
          season: w.season,
          userId: w.b,
          team: newTeam("Late"),
          now: new Date("2027-04-01"),
        }),
      ).toEqual({ ok: false, error: "closed" });
    });
  });

  it("stops at the team limit, but free agents can still join", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db, { maxTeams: 1 });
      await registerTeam(db, {
        ageConfirmed: true,
        leagueId: w.leagueId,
        season: w.season,
        userId: w.a,
        team: newTeam("One"),
        now: NOW,
      });
      expect(
        await registerTeam(db, {
          ageConfirmed: true,
          leagueId: w.leagueId,
          season: w.season,
          userId: w.b,
          team: newTeam("Two"),
          now: NOW,
        }),
      ).toEqual({ ok: false, error: "season_full" });
      expect(
        (
          await registerFreeAgent(db, {
            ageConfirmed: true,
            season: w.season,
            userId: w.b,
            now: NOW,
          })
        ).ok,
      ).toBe(true);
      expect(
        await registerFreeAgent(db, {
          ageConfirmed: true,
          season: w.season,
          userId: w.b,
          now: NOW,
        }),
      ).toEqual({
        ok: false,
        error: "already_registered",
      });
      const fa = await myRegistration(db, w.season.id, w.b);
      expect(fa).toMatchObject({ kind: "free_agent", team: null });
      expect(amountOwed(w.season, fa!, NOW)).toMatchObject({ cents: 8000 });
    });
  });

  it("starts at payment when the waiver is already signed", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const v = await publishWaiver(
        db,
        { leagueId: w.leagueId, title: "Release", body: BODY },
        w.a,
      );
      if (!v.ok) throw new Error();
      await assignWaiver(
        db,
        { leagueId: w.leagueId, seasonId: w.season.id, waiverId: v.value.id },
        w.a,
      );
      const signed = await signWaiver(db, {
        ageConfirmed: true,
        userId: w.c,
        seasonId: w.season.id,
        shownSha256: hashWaiverBody(BODY),
        agreed: true,
        signedName: "Alex Example",
        ip: null,
        userAgent: null,
      });
      expect(signed.ok).toBe(true);
      const s = (await seasonForRegistration(db, w.leagueId, "spring"))!;
      await registerFreeAgent(db, {
        ageConfirmed: true,
        season: s,
        userId: w.c,
        now: NOW,
      });
      expect(await myRegistration(db, s.id, w.c)).toMatchObject({
        status: "pending_payment",
      });
    });
  });

  it("per player, a captain pays their own fee and nothing is split", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db, {
        feeModel: "per_player",
        teamFeeCents: null,
        playerFeeCents: 8500,
      });
      const result = await registerTeam(db, {
        ageConfirmed: true,
        leagueId: w.leagueId,
        season: w.season,
        userId: w.a,
        team: newTeam("Solo"),
        now: NOW,
      });
      expect(result).toMatchObject({ ok: true, value: { shareCents: null } });
      const mine = await myRegistration(db, w.season.id, w.a);
      expect(mine?.team?.paymentMode).toBe("full");
      expect(amountOwed(w.season, mine!, NOW)).toMatchObject({ cents: 7500 });
    });
  });

  it("brings back a team the person captained before", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await registerTeam(db, {
        ageConfirmed: true,
        leagueId: w.leagueId,
        season: w.season,
        userId: w.a,
        team: newTeam("Old Guard"),
        now: NOW,
      });
      const [old] = await teamsCaptainedBy(db, w.leagueId, w.a);
      expect(old?.name).toBe("Old Guard");
      expect(await teamsCaptainedBy(db, w.leagueId, w.b)).toEqual([]);

      await db.insert(season).values({
        leagueId: w.leagueId,
        name: "Summer",
        slug: "summer",
        status: "registration_open",
        startsOn: "2027-06-06",
        endsOn: "2027-08-29",
        feeModel: "per_team",
        teamFeeCents: 120_000,
        rosterMin: 12,
        rosterMax: 20,
      });
      const summer = (await seasonForRegistration(db, w.leagueId, "summer"))!;
      // Someone else cannot claim it.
      expect(
        await registerTeam(db, {
          ageConfirmed: true,
          leagueId: w.leagueId,
          season: summer,
          userId: w.b,
          team: newTeam("", { teamId: old!.id }),
          now: NOW,
        }),
      ).toEqual({ ok: false, error: "bad_name" });
      const back = await registerTeam(db, {
        ageConfirmed: true,
        leagueId: w.leagueId,
        season: summer,
        userId: w.a,
        team: newTeam("", { teamId: old!.id, paymentMode: "full" }),
        now: NOW,
      });
      expect(back).toMatchObject({ ok: true, value: { shareCents: null } });
      const teams = await db
        .select({ id: team.id })
        .from(team)
        .where(eq(team.leagueId, w.leagueId));
      expect(teams).toHaveLength(1);
      const captains = await db
        .select({ role: rosterMembership.role })
        .from(rosterMembership)
        .innerJoin(teamSeason, eq(rosterMembership.teamSeasonId, teamSeason.id))
        .where(eq(teamSeason.teamId, old!.id));
      expect(captains.map((c) => c.role)).toEqual(["captain", "captain"]);
      expect(
        (await openSeasons(db, w.leagueId, NOW)).map((s) => s.slug),
      ).toEqual(["spring", "summer"]);
      expect(await seasonForRegistration(db, w.leagueId, "nope")).toBeNull();
    });
  });
});
