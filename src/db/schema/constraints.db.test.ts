import { afterAll, describe, it } from "vitest";
import {
  closePool,
  expectViolation,
  inRolledBackTransaction,
  insert,
  type Sql,
} from "../test/transaction";

afterAll(closePool);

/** A league with one season, two teams entered in it, and two registered players. */
async function world(sql: Sql) {
  const tag = Math.random().toString(36).slice(2, 8);
  const user = (n: number) =>
    insert(sql, "user", {
      name: `Test ${n}`,
      email: `db-test-${tag}-${n}@example.com`,
    });
  const leagueId = await insert(sql, "league", {
    name: "Test League",
    slug: `test-${tag}`,
  });
  const seasonId = await insert(sql, "season", {
    league_id: leagueId,
    name: "Spring",
    slug: "spring",
    starts_on: "2027-04-04",
    ends_on: "2027-06-06",
    fee_model: "per_player",
    player_fee_cents: 8500,
    roster_min: 12,
    roster_max: 20,
  });
  const team = (name: string, slug: string) =>
    insert(sql, "team", { league_id: leagueId, name, slug });
  const teamA = await team("Big Kicks", "big-kicks");
  const teamB = await team("Sun Kickers", "sun-kickers");
  const enter = (teamId: string) =>
    insert(sql, "team_season", { team_id: teamId, season_id: seasonId });
  const entryA = await enter(teamA);
  const entryB = await enter(teamB);
  const register = async (n: number) =>
    insert(sql, "registration", {
      season_id: seasonId,
      user_id: await user(n),
      kind: "team_member",
    });
  const alex = await register(1);
  const sam = await register(2);
  return { leagueId, seasonId, teamA, entryA, entryB, alex, sam };
}

const roster = (sql: Sql, row: Record<string, unknown>) =>
  insert(sql, "roster_membership", row);

describe("roster rules", () => {
  it("allows exactly one active captain per team", () =>
    inRolledBackTransaction(async (sql) => {
      const w = await world(sql);
      const captain = {
        team_season_id: w.entryA,
        role: "captain",
        status: "active",
      };
      await roster(sql, { ...captain, registration_id: w.alex });
      await expectViolation(sql, "roster_membership_one_captain", () =>
        roster(sql, { ...captain, registration_id: w.sam }),
      );
      // A co-captain alongside the captain is fine.
      await roster(sql, {
        team_season_id: w.entryA,
        registration_id: w.sam,
        role: "co_captain",
        status: "active",
      });
    }));

  it("keeps a player active on only one team per season", () =>
    inRolledBackTransaction(async (sql) => {
      const w = await world(sql);
      await roster(sql, {
        team_season_id: w.entryA,
        registration_id: w.alex,
        status: "active",
      });
      await expectViolation(sql, "roster_membership_one_active_team", () =>
        roster(sql, {
          team_season_id: w.entryB,
          registration_id: w.alex,
          status: "active",
        }),
      );
    }));

  it("blocks duplicate roster spots but keeps removed rows as history", () =>
    inRolledBackTransaction(async (sql) => {
      const w = await world(sql);
      const spot = { team_season_id: w.entryA, registration_id: w.alex };
      await roster(sql, { ...spot, status: "removed" });
      await roster(sql, { ...spot, status: "invited" });
      await expectViolation(sql, "roster_membership_spot_unique", () =>
        roster(sql, { ...spot, status: "invited" }),
      );
    }));
});

describe("one entry each", () => {
  it("lets a person register once per season", () =>
    inRolledBackTransaction(async (sql) => {
      const w = await world(sql);
      const [row] = await sql(
        "select user_id from registration where id = $1",
        [w.alex],
      );
      await expectViolation(sql, "registration_season_user_unique", () =>
        insert(sql, "registration", {
          season_id: w.seasonId,
          user_id: row?.user_id,
          kind: "free_agent",
        }),
      );
    }));

  it("lets a team enter a season once", () =>
    inRolledBackTransaction(async (sql) => {
      const w = await world(sql);
      await expectViolation(sql, "team_season_team_season_unique", () =>
        insert(sql, "team_season", { team_id: w.teamA, season_id: w.seasonId }),
      );
    }));
});

describe("season and team checks", () => {
  const fall = (leagueId: string, overrides: Record<string, unknown>) => ({
    league_id: leagueId,
    name: "Fall",
    slug: "fall",
    starts_on: "2027-09-05",
    ends_on: "2027-11-07",
    fee_model: "per_team",
    team_fee_cents: 120000,
    roster_min: 12,
    roster_max: 20,
    ...overrides,
  });

  it.each([
    ["season_dates_order", { ends_on: "2027-09-01" }],
    ["season_roster_limits", { roster_min: 20, roster_max: 12 }],
    ["season_games_per_day", { games_per_team_per_day: 3 }],
    ["season_fee_matches_model", { team_fee_cents: null }],
    ["season_fees_non_negative", { team_fee_cents: -1 }],
    ["season_league_slug_unique", { slug: "spring" }],
  ])("rejects a season that breaks %s", (constraint, overrides) =>
    inRolledBackTransaction(async (sql) => {
      const w = await world(sql);
      await expectViolation(sql, constraint, () =>
        insert(sql, "season", fall(w.leagueId, overrides)),
      );
    }),
  );

  it.each([
    ["team_slug_format", { slug: "Big Kicks!" }],
    ["team_color_hex", { color_hex: "red" }],
    ["team_league_slug_unique", { slug: "big-kicks" }],
  ])("rejects a team that breaks %s", (constraint, overrides) =>
    inRolledBackTransaction(async (sql) => {
      const w = await world(sql);
      await expectViolation(sql, constraint, () =>
        insert(sql, "team", {
          league_id: w.leagueId,
          name: "Odd",
          slug: "odd",
          ...overrides,
        }),
      );
    }),
  );
});
