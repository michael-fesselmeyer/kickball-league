import { afterAll, describe, expect, it } from "vitest";
import {
  closePool,
  expectViolation,
  inRolledBackTransaction,
  insert,
  type Sql,
} from "../test/transaction";

afterAll(closePool);

/** A season at a venue with two fields, two slots, and one game between two teams. */
async function world(sql: Sql) {
  const tag = Math.random().toString(36).slice(2, 8);
  const userId = await insert(sql, "user", {
    name: "Admin",
    email: `db-test-${tag}@example.test`,
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
  const field2Id = await insert(sql, "field", {
    venue_id: venueId,
    name: "Field 2",
  });
  const permitId = await insert(sql, "permit_window", {
    field_id: fieldId,
    season_id: seasonId,
    starts_at: "2027-04-04T14:00:00Z",
    ends_at: "2027-04-04T20:00:00Z",
    status: "confirmed",
  });
  const slot = (startsAt: string, endsAt: string, timeIndex: number) =>
    insert(sql, "slot", {
      season_id: seasonId,
      field_id: fieldId,
      permit_window_id: permitId,
      starts_at: startsAt,
      ends_at: endsAt,
      time_index: timeIndex,
    });
  const slotA = await slot("2027-04-04T14:00:00Z", "2027-04-04T15:30:00Z", 0);
  const slotB = await slot("2027-04-04T15:30:00Z", "2027-04-04T17:00:00Z", 1);
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
  const game = (a: string, b: string) =>
    insert(sql, "game", {
      season_id: seasonId,
      team_a_id: a,
      team_b_id: b,
      round_no: 1,
    });
  const gameId = await game(teamA, teamB);
  const game2Id = await game(teamB, teamA);
  const version = (versionNo: number, extra: Record<string, unknown> = {}) =>
    insert(sql, "schedule_version", {
      season_id: seasonId,
      version_no: versionNo,
      origin: "generated",
      input_snapshot: JSON.stringify({ seed: 1 }),
      ...extra,
    });
  return {
    userId,
    seasonId,
    fieldId,
    field2Id,
    permitId,
    slotA,
    slotB,
    teamA,
    gameId,
    game2Id,
    version,
  };
}

describe("permits and blackouts", () => {
  it("rejects a permit that ends before it starts", () =>
    inRolledBackTransaction(async (sql) => {
      const w = await world(sql);
      await expectViolation(sql, "permit_window_times_order", () =>
        insert(sql, "permit_window", {
          field_id: w.fieldId,
          season_id: w.seasonId,
          starts_at: "2027-04-04T20:00:00Z",
          ends_at: "2027-04-04T14:00:00Z",
        }),
      );
    }));

  it("allows one blackout per date for all fields, and one per field", () =>
    inRolledBackTransaction(async (sql) => {
      const w = await world(sql);
      const blackout = (fieldId: string | null) =>
        insert(sql, "blackout", {
          season_id: w.seasonId,
          on_date: "2027-05-30",
          field_id: fieldId,
          reason: "Memorial Day weekend",
        });
      await blackout(null);
      await blackout(w.fieldId);
      await blackout(w.field2Id);
      await expectViolation(sql, "blackout_season_date_field_unique", () =>
        blackout(null),
      );
      await expectViolation(sql, "blackout_season_date_field_unique", () =>
        blackout(w.fieldId),
      );
    }));
});

describe("team constraints", () => {
  it("needs a date or a time, a sensible time and a weight from 1 to 10", () =>
    inRolledBackTransaction(async (sql) => {
      const w = await world(sql);
      const constraint = (row: Record<string, unknown>) =>
        insert(sql, "team_constraint", {
          team_season_id: w.teamA,
          kind: "prefer",
          ...row,
        });
      await constraint({ time_index: 0 });
      await constraint({ on_date: "2027-04-11", kind: "unavailable" });
      await expectViolation(sql, "team_constraint_has_date_or_time", () =>
        constraint({}),
      );
      await expectViolation(
        sql,
        "team_constraint_time_index_non_negative",
        () => constraint({ time_index: -1 }),
      );
      await expectViolation(sql, "team_constraint_weight_range", () =>
        constraint({ time_index: 0, weight: 11 }),
      );
    }));
});

describe("schedule versions", () => {
  it("numbers versions once per season, from 1", () =>
    inRolledBackTransaction(async (sql) => {
      const w = await world(sql);
      await w.version(1);
      await expectViolation(sql, "schedule_version_season_no_unique", () =>
        w.version(1),
      );
      await expectViolation(sql, "schedule_version_no_positive", () =>
        w.version(0),
      );
    }));

  it("publishes one version per season at a time, with a publish time", () =>
    inRolledBackTransaction(async (sql) => {
      const w = await world(sql);
      const published = {
        status: "published",
        published_at: "2027-03-01T12:00:00Z",
      };
      const first = await w.version(1, published);
      await expectViolation(sql, "schedule_version_one_published", () =>
        w.version(2, published),
      );
      await expectViolation(sql, "schedule_version_published_has_time", () =>
        w.version(2, { status: "published" }),
      );
      // Superseding the first lets the second be published.
      await sql(
        `update schedule_version set status = 'superseded' where id = $1`,
        [first],
      );
      await w.version(2, { ...published, parent_version_id: first });
    }));
});

describe("game placements", () => {
  it("places a game once per version and one game per slot", () =>
    inRolledBackTransaction(async (sql) => {
      const w = await world(sql);
      const v1 = await w.version(1);
      const place = (gameId: string, slotId: string | null, extra = {}) =>
        insert(sql, "game_placement", {
          schedule_version_id: v1,
          game_id: gameId,
          slot_id: slotId,
          ...extra,
        });
      await place(w.gameId, w.slotA);
      await expectViolation(sql, "game_placement_version_game_unique", () =>
        place(w.gameId, w.slotB),
      );
      await expectViolation(sql, "game_placement_version_slot_unique", () =>
        place(w.game2Id, w.slotA),
      );
      // Unplaced games do not compete for a slot.
      await place(w.game2Id, null);
      // The same slot in another version is fine.
      const v2 = await w.version(2);
      await insert(sql, "game_placement", {
        schedule_version_id: v2,
        game_id: w.gameId,
        slot_id: w.slotA,
      });
    }));

  it("pins only placed games, and goes with its version", () =>
    inRolledBackTransaction(async (sql) => {
      const w = await world(sql);
      const v1 = await w.version(1);
      await expectViolation(sql, "game_placement_locked_has_slot", () =>
        insert(sql, "game_placement", {
          schedule_version_id: v1,
          game_id: w.gameId,
          slot_id: null,
          locked: true,
        }),
      );
      await insert(sql, "game_placement", {
        schedule_version_id: v1,
        game_id: w.gameId,
        slot_id: w.slotA,
        locked: true,
      });
      await sql(`delete from schedule_version where id = $1`, [v1]);
      const left = await sql(
        `select count(*)::int as n from game_placement where schedule_version_id = $1`,
        [v1],
      );
      expect(left[0]?.n).toBe(0);
    }));

  it("keeps a slot that a version still uses", () =>
    inRolledBackTransaction(async (sql) => {
      const w = await world(sql);
      const v1 = await w.version(1);
      await insert(sql, "game_placement", {
        schedule_version_id: v1,
        game_id: w.gameId,
        slot_id: w.slotA,
      });
      await expectViolation(sql, "game_placement_slot_id_slot_id_fk", () =>
        sql(`delete from slot where id = $1`, [w.slotA]),
      );
    }));
});
