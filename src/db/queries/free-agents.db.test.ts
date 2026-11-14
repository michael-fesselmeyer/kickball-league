import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { RegistrationId, UserId } from "@/domain/ids";
import { suggestPlacements } from "@/domain/matcher/matcher";
import { parseQuiz } from "@/domain/matcher/quiz";
import { auditLog } from "../schema/audit";
import { user } from "../schema/auth";
import { freeAgentProfile } from "../schema/free-agent";
import { league } from "../schema/league";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { registration, rosterMembership, teamSeason } from "../schema/team";
import { deleteAccount, personalData } from "./account";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  buildTeamFromPool,
  joinFriendGroup,
  leaveFriendGroup,
  matcherInput,
  myQuiz,
  placeTogether,
  saveQuiz,
  startFriendGroup,
} from "./free-agents";
import {
  registerFreeAgent,
  registerTeam,
  seasonForRegistration,
} from "./registration";
import type { Db } from "./schedule";

afterAll(closePool);

const NOW = new Date("2027-02-15T17:00:00Z");

/** A fixed sequence of "random" numbers, so friend codes are predictable. */
function rolls(...values: number[]) {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
}

const quiz = (over: Record<string, unknown> = {}) => {
  const parsed = parseQuiz({
    experience: "some",
    positions: ["pitcher"],
    availability: "every_week",
    vibe: "social",
    captain: "no",
    ...over,
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
};

async function world(db: Db, rosterMax = 6) {
  const tag = Math.random().toString(36).slice(2, 8);
  const people: [string, "woman" | "man"][] = [
    ["Robin", "woman"],
    ["Ana", "woman"],
    ["Ben", "man"],
    ["Cleo", "woman"],
    ["Dev", "man"],
    ["Admin", "man"],
  ];
  const users = await db
    .insert(user)
    .values(
      people.map(([n]) => ({ name: n, email: `fa-${n}-${tag}@example.test` })),
    )
    .returning({ id: user.id });
  await db.insert(profile).values(
    users.map((u, i) => ({
      userId: u.id,
      firstName: people[i]?.[0] ?? "",
      lastName: "Example",
      lineupGender: people[i]?.[1],
    })),
  );
  const [lg] = await db
    .insert(league)
    .values({ name: "Test League", slug: `fa-${tag}` })
    .returning({ id: league.id });
  if (!lg) throw new Error("no league");
  await db.insert(season).values({
    leagueId: lg.id,
    name: "Spring",
    slug: "spring",
    status: "registration_open",
    startsOn: "2027-04-05",
    endsOn: "2027-06-28",
    feeModel: "per_team",
    teamFeeCents: 120_000,
    freeAgentFeeCents: 9000,
    rosterMin: 2,
    rosterMax,
  });
  const s = await seasonForRegistration(db, lg.id, "spring");
  if (!s) throw new Error("no season");
  const ids = users.map((u) => u.id) as UserId[];
  const [captain, ana, ben, cleo, dev, admin] = ids as [
    UserId,
    UserId,
    UserId,
    UserId,
    UserId,
    UserId,
  ];
  const t = await registerTeam(db, {
    ageConfirmed: true,
    leagueId: lg.id,
    season: s,
    userId: captain,
    team: {
      teamId: null,
      name: "Kick Bottom",
      colorHex: null,
      paymentMode: "split",
      rosterSize: Math.min(4, rosterMax),
    },
    now: NOW,
  });
  if (!t.ok) throw new Error(t.error);
  const reg: Record<string, RegistrationId> = {};
  for (const [name, id] of [
    ["ana", ana],
    ["ben", ben],
    ["cleo", cleo],
    ["dev", dev],
  ] as const) {
    const r = await registerFreeAgent(db, {
      ageConfirmed: true,
      season: s,
      userId: id,
      now: NOW,
    });
    if (!r.ok) throw new Error(r.error);
    reg[name] = r.value;
  }
  return {
    leagueId: lg.id,
    season: s,
    captain,
    ana,
    ben,
    cleo,
    dev,
    admin,
    teamSeasonId: t.value.teamSeasonId,
    reg: reg as Record<"ana" | "ben" | "cleo" | "dev", RegistrationId>,
  };
}

describe("the quiz", () => {
  it("saves and replaces a free agent's answers, with scores", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const input = { seasonId: w.season.id, userId: w.ana };
      expect(await saveQuiz(db, { ...input, quiz: quiz() })).toEqual({
        ok: true,
        value: undefined,
      });
      await saveQuiz(db, {
        ...input,
        quiz: quiz({ vibe: "competitive", captain: "yes" }),
      });
      const [row] = await db
        .select()
        .from(freeAgentProfile)
        .where(eq(freeAgentProfile.registrationId, w.reg.ana));
      expect(row).toMatchObject({
        skillScore: 3,
        vibeScore: 5,
        wouldCaptain: true,
      });
      expect((await myQuiz(db, w.season.id, w.ana))?.answers).toMatchObject({
        vibe: "competitive",
      });
    });
  });

  it("is in the player's export, and goes when they delete their account", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const s = w.season.id;
      await saveQuiz(db, {
        seasonId: s,
        userId: w.ana,
        quiz: quiz({ notes: "Left-footed" }),
      });
      await startFriendGroup(db, {
        seasonId: s,
        userId: w.ana,
        random: rolls(0.7),
      });
      const data = await personalData(db, w.ana, NOW);
      expect(data?.registrations[0]?.freeAgentQuiz).toMatchObject({
        answers: { vibe: "social" },
        notes: "Left-footed",
      });
      expect(await deleteAccount(db, w.ana, NOW)).toMatchObject({ ok: true });
      expect(
        await db
          .select()
          .from(freeAgentProfile)
          .where(eq(freeAgentProfile.registrationId, w.reg.ana)),
      ).toEqual([]);
      const [left] = await db
        .select({ group: registration.friendGroupId })
        .from(registration)
        .where(eq(registration.id, w.reg.ana));
      expect(left?.group).toBeNull();
    });
  });

  it("is only for free agents still in the pool", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      expect(
        await saveQuiz(db, {
          seasonId: w.season.id,
          userId: w.captain,
          quiz: quiz(),
        }),
      ).toEqual({ ok: false, error: "not_in_pool" });
    });
  });
});

describe("friend codes", () => {
  it("lets friends join a group by code, up to the limit, and leave it", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const s = w.season.id;
      const started = await startFriendGroup(db, {
        seasonId: s,
        userId: w.ana,
        random: rolls(0, 0.1, 0.2, 0.3, 0.4, 0.5),
      });
      if (!started.ok) throw new Error(started.error);
      const code = started.value;
      expect(code).toMatch(/^[A-Z2-9]{6}$/);

      expect(
        await joinFriendGroup(db, { seasonId: s, userId: w.ben, code }),
      ).toEqual({ ok: true, value: undefined });
      expect(
        await joinFriendGroup(db, { seasonId: s, userId: w.ben, code }),
      ).toEqual({ ok: false, error: "already_in_group" });
      expect(
        await joinFriendGroup(db, {
          seasonId: s,
          userId: w.cleo,
          code: "ZZZZZZ",
        }),
      ).toEqual({ ok: false, error: "unknown_code" });
      expect(
        await joinFriendGroup(db, { seasonId: s, userId: w.captain, code }),
      ).toEqual({ ok: false, error: "not_in_pool" });

      const ana = await myQuiz(db, s, w.ana);
      expect(ana).toMatchObject({ code, friends: ["Ben E."] });

      await leaveFriendGroup(db, { seasonId: s, userId: w.ben });
      expect((await myQuiz(db, s, w.ana))?.friends).toEqual([]);
    });
  });

  it("caps a group at four", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const s = w.season.id;
      const started = await startFriendGroup(db, {
        seasonId: s,
        userId: w.ana,
        random: rolls(0.9),
      });
      if (!started.ok) throw new Error(started.error);
      const code = started.value;
      for (const userId of [w.ben, w.cleo, w.dev])
        await joinFriendGroup(db, { seasonId: s, userId, code });
      const extra = await registerFreeAgent(db, {
        ageConfirmed: true,
        season: w.season,
        userId: w.admin,
        now: NOW,
      });
      if (!extra.ok) throw new Error(extra.error);
      expect(
        await joinFriendGroup(db, { seasonId: s, userId: w.admin, code }),
      ).toEqual({ ok: false, error: "group_full" });
    });
  });
});

describe("the matcher's view", () => {
  it("reads teams and the pool in matcher terms, and its suggestions apply", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const s = w.season.id;
      const started = await startFriendGroup(db, {
        seasonId: s,
        userId: w.ana,
        random: rolls(0.5),
      });
      if (!started.ok) throw new Error(started.error);
      await joinFriendGroup(db, {
        seasonId: s,
        userId: w.dev,
        code: started.value,
      });
      await saveQuiz(db, { seasonId: s, userId: w.ana, quiz: quiz() });

      const input = await matcherInput(db, s);
      if (!input) throw new Error("no input");
      expect(
        input.teams.map((t) => [t.name, t.capacity, t.members.length]),
      ).toEqual([["Kick Bottom", 4, 1]]);
      expect(input.pool.map((p) => [p.name, p.side, p.skill]).sort()).toEqual([
        ["Ana Example", "woman", 3],
        ["Ben Example", "man", null],
        ["Cleo Example", "woman", null],
        ["Dev Example", "man", null],
      ]);

      const { suggestions } = suggestPlacements(input.pool, input.teams);
      const group = suggestions.find((x) => x.names.includes("Ana Example"));
      expect(group?.names.slice().sort()).toEqual([
        "Ana Example",
        "Dev Example",
      ]);
      const placed = await placeTogether(db, {
        seasonId: s,
        registrationIds: group?.registrationIds as RegistrationId[],
        teamSeasonId: w.teamSeasonId,
        actorId: w.admin,
        now: NOW,
      });
      expect(placed).toEqual({ ok: true, value: undefined });
      const after = await matcherInput(db, s);
      expect(after?.pool.map((p) => p.name).sort()).toEqual([
        "Ben Example",
        "Cleo Example",
      ]);
      expect(after?.teams[0]?.members).toHaveLength(3);
    });
  });

  it("will not split a friend group or overfill a team", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const s = w.season.id;
      const started = await startFriendGroup(db, {
        seasonId: s,
        userId: w.ana,
        random: rolls(0.25),
      });
      if (!started.ok) throw new Error(started.error);
      await joinFriendGroup(db, {
        seasonId: s,
        userId: w.ben,
        code: started.value,
      });
      const place = (ids: RegistrationId[]) =>
        placeTogether(db, {
          seasonId: s,
          registrationIds: ids,
          teamSeasonId: w.teamSeasonId,
          actorId: w.admin,
          now: NOW,
        });
      expect(await place([w.reg.ana])).toEqual({
        ok: false,
        error: "splits_group",
      });
      await db.update(season).set({ rosterMax: 2 }).where(eq(season.id, s));
      expect(await place([w.reg.ana, w.reg.ben])).toEqual({
        ok: false,
        error: "full",
      });
      const spots = await db
        .select()
        .from(rosterMembership)
        .where(eq(rosterMembership.teamSeasonId, w.teamSeasonId));
      expect(spots).toHaveLength(1);
    });
  });
});

describe("building a team from the pool", () => {
  it("creates a forming team with a captain, priced like free agents", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const built = await buildTeamFromPool(db, {
        leagueId: w.leagueId,
        seasonId: w.season.id,
        name: "  Free  Radicals ",
        colorHex: "#FF6600",
        captainId: w.reg.cleo,
        registrationIds: [w.reg.ana, w.reg.ben, w.reg.cleo],
        actorId: w.admin,
        now: NOW,
      });
      if (!built.ok) throw new Error(built.error);
      expect(built.value.slug).toBe("free-radicals");
      const [entry] = await db
        .select()
        .from(teamSeason)
        .where(eq(teamSeason.id, built.value.teamSeasonId));
      expect(entry).toMatchObject({
        status: "forming",
        paymentMode: "split",
        shareCents: 9000,
        targetRosterSize: 3,
      });
      const roster = await db
        .select({
          role: rosterMembership.role,
          kind: registration.kind,
        })
        .from(rosterMembership)
        .innerJoin(
          registration,
          eq(rosterMembership.registrationId, registration.id),
        )
        .where(eq(rosterMembership.teamSeasonId, built.value.teamSeasonId));
      expect(roster.map((r) => r.role).sort()).toEqual([
        "captain",
        "player",
        "player",
      ]);
      expect(new Set(roster.map((r) => r.kind))).toEqual(
        new Set(["free_agent"]),
      );
      const audits = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.entityId, built.value.teamSeasonId));
      expect(audits).toEqual([{ action: "free_agents.build_team" }]);
    });
  });

  it("refuses a bad name, a taken name, a missing captain or too many players", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db, 2);
      const build = (over: Partial<Parameters<typeof buildTeamFromPool>[1]>) =>
        buildTeamFromPool(db, {
          leagueId: w.leagueId,
          seasonId: w.season.id,
          name: "Free Radicals",
          colorHex: null,
          captainId: w.reg.ana,
          registrationIds: [w.reg.ana, w.reg.ben],
          actorId: w.admin,
          now: NOW,
          ...over,
        });
      expect(await build({ name: "!!!" })).toEqual({
        ok: false,
        error: "bad_name",
      });
      expect(await build({ name: "Kick Bottom" })).toEqual({
        ok: false,
        error: "name_taken",
      });
      expect(await build({ captainId: w.reg.cleo })).toEqual({
        ok: false,
        error: "no_captain",
      });
      expect(
        await build({ registrationIds: [w.reg.ana, w.reg.ben, w.reg.cleo] }),
      ).toEqual({ ok: false, error: "too_many" });
    });
  });
});
