import { afterAll, describe, it } from "vitest";
import {
  closePool,
  expectViolation,
  inRolledBackTransaction,
  insert,
  type Sql,
} from "../test/transaction";

afterAll(closePool);

/** A season at a venue with one field, one slot and two team entries. */
async function world(sql: Sql) {
  const tag = Math.random().toString(36).slice(2, 8);
  const userId = await insert(sql, "user", {
    name: "Ref",
    email: `db-test-${tag}@example.com`,
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
    fee_model: "per_team",
    team_fee_cents: 120000,
    roster_min: 12,
    roster_max: 20,
  });
  const venueId = await insert(sql, "venue", {
    league_id: leagueId,
    name: "McCarren Park",
    slug: "mccarren-park",
  });
  const fieldId = await insert(sql, "field", {
    venue_id: venueId,
    name: "Field 1",
  });
  const slotId = await insert(sql, "slot", {
    season_id: seasonId,
    field_id: fieldId,
    starts_at: "2027-04-04T14:00:00Z",
    ends_at: "2027-04-04T15:00:00Z",
    time_index: 0,
  });
  const entry = async (slug: string) =>
    insert(sql, "team_season", {
      team_id: await insert(sql, "team", {
        league_id: leagueId,
        name: slug,
        slug,
      }),
      season_id: seasonId,
    });
  const teamA = await entry("big-kicks");
  const teamB = await entry("sun-kickers");
  const teamC = await entry("base-invaders");
  const gameId = await insert(sql, "game", {
    season_id: seasonId,
    team_a_id: teamA,
    team_b_id: teamB,
    slot_id: slotId,
  });
  return {
    userId,
    leagueId,
    seasonId,
    venueId,
    fieldId,
    slotId,
    teamA,
    teamB,
    teamC,
    gameId,
  };
}

describe("games", () => {
  it("never lets a team play itself", () =>
    inRolledBackTransaction(async (sql) => {
      const w = await world(sql);
      await expectViolation(sql, "game_distinct_teams", () =>
        insert(sql, "game", {
          season_id: w.seasonId,
          team_a_id: w.teamA,
          team_b_id: w.teamA,
        }),
      );
    }));

  it("requires a score and a time before a game is final", () =>
    inRolledBackTransaction(async (sql) => {
      const w = await world(sql);
      const game = {
        season_id: w.seasonId,
        team_a_id: w.teamA,
        team_b_id: w.teamB,
      };
      await expectViolation(sql, "game_final_has_score", () =>
        insert(sql, "game", { ...game, status: "final", score_a: 7 }),
      );
      await insert(sql, "game", {
        ...game,
        status: "final",
        score_a: 7,
        score_b: 4,
        finalized_at: "2027-04-04T15:05:00Z",
      });
    }));

  it("rejects negative scores", () =>
    inRolledBackTransaction(async (sql) => {
      const w = await world(sql);
      await expectViolation(sql, "game_scores_non_negative", () =>
        insert(sql, "game", {
          season_id: w.seasonId,
          team_a_id: w.teamA,
          team_b_id: w.teamB,
          score_a: -1,
        }),
      );
    }));

  it("records a forfeit only against a team in the game, and only for forfeits", () =>
    inRolledBackTransaction(async (sql) => {
      const w = await world(sql);
      const game = {
        season_id: w.seasonId,
        team_a_id: w.teamA,
        team_b_id: w.teamB,
      };
      await expectViolation(sql, "game_forfeit_by_a_team", () =>
        insert(sql, "game", {
          ...game,
          status: "forfeit",
          forfeit_by: w.teamC,
        }),
      );
      await expectViolation(sql, "game_forfeit_by_a_team", () =>
        insert(sql, "game", { ...game, status: "forfeit" }),
      );
      await expectViolation(sql, "game_forfeit_by_a_team", () =>
        insert(sql, "game", {
          ...game,
          status: "scheduled",
          forfeit_by: w.teamA,
        }),
      );
      await insert(sql, "game", {
        ...game,
        status: "forfeit",
        forfeit_by: w.teamB,
      });
    }));
});

describe("fields and slots", () => {
  it("keeps one slot per field per start time", () =>
    inRolledBackTransaction(async (sql) => {
      const w = await world(sql);
      await expectViolation(sql, "slot_field_start_unique", () =>
        insert(sql, "slot", {
          season_id: w.seasonId,
          field_id: w.fieldId,
          starts_at: "2027-04-04T14:00:00Z",
          ends_at: "2027-04-04T15:00:00Z",
          time_index: 0,
        }),
      );
    }));

  it("rejects a slot that ends before it starts", () =>
    inRolledBackTransaction(async (sql) => {
      const w = await world(sql);
      await expectViolation(sql, "slot_times_order", () =>
        insert(sql, "slot", {
          season_id: w.seasonId,
          field_id: w.fieldId,
          starts_at: "2027-04-11T15:00:00Z",
          ends_at: "2027-04-11T14:00:00Z",
          time_index: 1,
        }),
      );
    }));

  it("names fields uniquely within a venue", () =>
    inRolledBackTransaction(async (sql) => {
      const w = await world(sql);
      await expectViolation(sql, "field_venue_name_unique", () =>
        insert(sql, "field", { venue_id: w.venueId, name: "Field 1" }),
      );
    }));
});

describe("score reports", () => {
  it("ignores a retried submit from the same device", () =>
    inRolledBackTransaction(async (sql) => {
      const w = await world(sql);
      const report = {
        game_id: w.gameId,
        reported_by: w.userId,
        reporter_role: "referee",
        score_a: 7,
        score_b: 4,
        client_id: "device-123-submit-1",
      };
      await insert(sql, "score_report", report);
      await expectViolation(sql, "score_report_client_id_unique", () =>
        insert(sql, "score_report", report),
      );
    }));

  it("rejects negative scores", () =>
    inRolledBackTransaction(async (sql) => {
      const w = await world(sql);
      await expectViolation(sql, "score_report_scores_non_negative", () =>
        insert(sql, "score_report", {
          game_id: w.gameId,
          reported_by: w.userId,
          reporter_role: "captain",
          score_a: 3,
          score_b: -2,
          client_id: "device-456-submit-1",
        }),
      );
    }));
});
