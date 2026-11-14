import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import type { LeagueId, UserId } from "@/domain/ids";
import * as schema from "../schema";
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
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  myRegistration,
  registerFreeAgent,
  registerTeam,
  type SeasonForRegistration,
  seasonForRegistration,
  type TeamInput,
} from "./registration";
import type { Db } from "./schedule";

afterAll(closePool);

const NOW = new Date("2027-02-15T17:00:00Z");

async function world(db: Db, maxTeams: number | null = null) {
  const tag = Math.random().toString(36).slice(2, 8);
  const people = await db
    .insert(user)
    .values(
      ["a", "b"].map((p) => ({
        name: p,
        email: `reg-race-${p}-${tag}@example.test`,
      })),
    )
    .returning({ id: user.id });
  await db.insert(profile).values(
    people.map((p, i) => ({
      userId: p.id,
      firstName: ["Robin", "Sam"][i],
      lastName: "Example",
    })),
  );
  const [lg] = await db
    .insert(league)
    .values({ name: "Test League", slug: `reg-race-${tag}` })
    .returning({ id: league.id });
  const leagueId = lg!.id;
  await db.insert(season).values({
    leagueId,
    name: "Spring",
    slug: "spring",
    status: "registration_open",
    startsOn: "2027-04-05",
    endsOn: "2027-06-28",
    feeModel: "per_team",
    teamFeeCents: 120_000,
    freeAgentFeeCents: 9000,
    maxTeams,
    rosterMin: 12,
    rosterMax: 20,
  });
  const s = (await seasonForRegistration(
    db,
    leagueId,
    "spring",
  )) as SeasonForRegistration;
  const [a, b] = people.map((p) => p.id) as [UserId, UserId];
  return { leagueId, season: s, a, b };
}

type World = Awaited<ReturnType<typeof world>>;

const newTeam = (name: string): TeamInput => ({
  teamId: null,
  name,
  colorHex: null,
  paymentMode: "split",
  rosterSize: 14,
});

const register = (db: Db, w: World, userId: UserId, name: string) =>
  registerTeam(db, {
    ageConfirmed: true,
    leagueId: w.leagueId,
    season: w.season,
    userId,
    team: newTeam(name),
    now: NOW,
  });

describe("team names in any script", () => {
  it("registers teams named in Arabic, Japanese or only emoji, and still catches a taken one", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const arabic = await register(db, w, w.a, "الركلات");
      expect(arabic.ok).toBe(true);
      expect((await myRegistration(db, w.season.id, w.a))?.team).toMatchObject({
        teamName: "الركلات",
      });
      // The same name again, with stray spaces, is the same team's name.
      expect(await register(db, w, w.b, "  الركلات ")).toEqual({
        ok: false,
        error: "name_taken",
      });
      const emoji = await register(db, w, w.b, "🔥🔥🔥");
      expect(emoji.ok).toBe(true);
      const slugs = await db
        .select({ slug: team.slug })
        .from(team)
        .where(eq(team.leagueId, w.leagueId));
      expect(slugs.map((s) => s.slug).sort()).toEqual([
        expect.stringMatching(/^team-[0-9a-z]+$/),
        expect.stringMatching(/^team-[0-9a-z]+$/),
      ]);
    });
  });

  it("still refuses a name with nothing in it", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      expect(await register(db, w, w.a, " - . ")).toEqual({
        ok: false,
        error: "bad_name",
      });
    });
  });
});

describe("registering twice at once", () => {
  const clients: Client[] = [];
  const connect = async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    clients.push(client);
    return drizzle({ client, schema, casing: "snake_case" });
  };
  afterAll(() => Promise.all(clients.map((c) => c.end())));

  /** Runs `body` against a committed world, then deletes it. */
  const withWorld = async (
    maxTeams: number | null,
    body: (w: World) => Promise<void>,
  ) => {
    const setup = await connect();
    const w = await world(setup, maxTeams);
    try {
      await body(w);
    } finally {
      await removeWorld(setup, w.leagueId, [w.a, w.b]);
    }
  };

  for (const maxTeams of [null, 8]) {
    it(`registers a double-tapped team once and says so to the second tap (team limit ${maxTeams ?? "none"})`, async () => {
      await withWorld(maxTeams, async (w) => {
        const [one, two] = [await connect(), await connect()];
        const results = await Promise.all(
          [one, two].map((db) =>
            db.transaction((tx) => register(tx, w, w.a, "Double Tap")),
          ),
        );
        expect(results.filter((r) => r.ok)).toHaveLength(1);
        expect(results.filter((r) => !r.ok)).toEqual([
          { ok: false, error: "already_registered" },
        ]);
      });
    });
  }

  it("registers a double-tapped free agent once", async () => {
    await withWorld(null, async (w) => {
      const [one, two] = [await connect(), await connect()];
      const results = await Promise.all(
        [one, two].map((db) =>
          db.transaction((tx) =>
            registerFreeAgent(tx, {
              season: w.season,
              userId: w.b,
              ageConfirmed: true,
              now: NOW,
            }),
          ),
        ),
      );
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok)).toEqual([
        { ok: false, error: "already_registered" },
      ]);
    });
  });

  it("gives one of two captains the name and tells the other it is taken", async () => {
    await withWorld(null, async (w) => {
      const [one, two] = [await connect(), await connect()];
      const results = await Promise.all([
        one.transaction((tx) => register(tx, w, w.a, "Same Name")),
        two.transaction((tx) => register(tx, w, w.b, "Same Name")),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok)).toEqual([
        { ok: false, error: "name_taken" },
      ]);
    });
  });
});

async function removeWorld(db: Db, leagueId: LeagueId, people: UserId[]) {
  const seasons = db
    .select({ id: season.id })
    .from(season)
    .where(eq(season.leagueId, leagueId));
  const entries = db
    .select({ id: teamSeason.id })
    .from(teamSeason)
    .where(inArray(teamSeason.seasonId, seasons));
  await db
    .delete(rosterMembership)
    .where(inArray(rosterMembership.teamSeasonId, entries));
  await db.delete(registration).where(inArray(registration.seasonId, seasons));
  await db.delete(teamSeason).where(inArray(teamSeason.seasonId, seasons));
  await db.delete(team).where(eq(team.leagueId, leagueId));
  await db.delete(season).where(eq(season.leagueId, leagueId));
  await db.delete(league).where(eq(league.id, leagueId));
  await db.delete(auditLog).where(inArray(auditLog.actorId, people));
  await db.delete(profile).where(inArray(profile.userId, people));
  await db.delete(user).where(inArray(user.id, people));
}
