import { afterAll, describe, expect, it } from "vitest";
import { division, ruleSet } from "../schema/division";
import { field, game, slot, venue } from "../schema/game";
import { league } from "../schema/league";
import { permitWindow } from "../schema/schedule";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import { closePool, inRolledBackDb } from "../test/transaction";
import { gameLimitsFor, permitInfoFor } from "./permit-watch";
import { required } from "./rows";
import type { Db } from "./schedule";

afterAll(closePool);

const one = <T>(rows: T[], what: string) => required(rows[0], what);

const at = (hhmm: string, day = "2026-11-14") => new Date(`${day}T${hhmm}:00Z`);

/** A game at 9 pm New York on Nov 14 (02:00 UTC on the 15th) cut from a permit. */
async function world(db: Db, options: { withRules: boolean }) {
  const tag = Math.random().toString(36).slice(2, 8);
  const lg = one(
    await db
      .insert(league)
      .values({ name: "Test League", slug: `pw-${tag}` })
      .returning({ id: league.id }),
    "league",
  );
  const sn = one(
    await db
      .insert(season)
      .values({
        leagueId: lg.id,
        name: "Fall",
        slug: `fall-${tag}`,
        status: "in_progress",
        startsOn: "2026-09-01",
        endsOn: "2026-12-01",
        feeModel: "per_player",
        playerFeeCents: 8500,
        rosterMin: 1,
        rosterMax: 20,
      })
      .returning({ id: season.id }),
    "season",
  );
  const park = one(
    await db
      .insert(venue)
      .values({ leagueId: lg.id, name: "Example Park", slug: `p-${tag}` })
      .returning({ id: venue.id }),
    "venue",
  );
  const [f1, f2] = (
    await db
      .insert(field)
      .values(
        ["Field 1", "Field 2"].map((name) => ({ venueId: park.id, name })),
      )
      .returning({ id: field.id })
  ).map((f) => f.id);
  if (!f1 || !f2) throw new Error("no fields");
  const rules = options.withRules
    ? one(
        await db
          .insert(ruleSet)
          .values({
            leagueId: lg.id,
            name: "Social",
            innings: 5,
            timeLimitMinutes: 60,
            options: {
              permitEndRule: "last_inning_to_start",
              noNewInningMinutes: 5,
            },
          })
          .returning({ id: ruleSet.id }),
        "rules",
      )
    : null;
  const div = rules
    ? one(
        await db
          .insert(division)
          .values({
            seasonId: sn.id,
            name: "Social",
            slug: "social",
            ruleSetId: rules.id,
          })
          .returning({ id: division.id }),
        "division",
      )
    : null;
  const teams = await db
    .insert(team)
    .values(
      ["Aces", "Bees"].map((name) => ({
        leagueId: lg.id,
        name,
        slug: `${name.toLowerCase()}-${tag}`,
      })),
    )
    .returning({ id: team.id });
  const [a, b] = (
    await db
      .insert(teamSeason)
      .values(
        teams.map((t) => ({
          teamId: t.id,
          seasonId: sn.id,
          ...(div ? { divisionId: div.id } : {}),
        })),
      )
      .returning({ id: teamSeason.id })
  ).map((t) => t.id);
  if (!a || !b) throw new Error("no entries");
  return { seasonId: sn.id, f1, f2, a, b };
}

const permit = async (
  db: Db,
  w: Awaited<ReturnType<typeof world>>,
  fieldId: typeof w.f1,
  startsAt: Date,
  endsAt: Date,
  status: "confirmed" | "requested" | "lost" = "confirmed",
) =>
  one(
    await db
      .insert(permitWindow)
      .values({ fieldId, seasonId: w.seasonId, startsAt, endsAt, status })
      .returning({ id: permitWindow.id }),
    "permit",
  ).id;

const play = async (
  db: Db,
  w: Awaited<ReturnType<typeof world>>,
  fieldId: typeof w.f1,
  permitWindowId: Awaited<ReturnType<typeof permit>> | null,
) => {
  const s = one(
    await db
      .insert(slot)
      .values({
        seasonId: w.seasonId,
        fieldId,
        permitWindowId,
        startsAt: at("01:00", "2026-11-15"),
        endsAt: at("02:00", "2026-11-15"),
        timeIndex: 0,
      })
      .returning({ id: slot.id }),
    "slot",
  );
  return one(
    await db
      .insert(game)
      .values({
        seasonId: w.seasonId,
        teamAId: w.a,
        teamBId: w.b,
        slotId: s.id,
      })
      .returning({ id: game.id }),
    "game",
  ).id;
};

describe("permit info for a game", () => {
  it("is the end of the window the slot was cut from, with the rule set's limits and rule", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db, { withRules: true });
      const p = await permit(
        db,
        w,
        w.f1,
        at("00:00", "2026-11-15"),
        at("03:00", "2026-11-15"),
      );
      const id = await play(db, w, w.f1, p);
      const info = (await permitInfoFor(db, [id])).get(id);
      expect(info).toEqual({
        permitEndsAt: at("03:00", "2026-11-15"),
        slotStartsAt: at("01:00", "2026-11-15"),
        timeLimitMinutes: 60,
        innings: 5,
        rule: "last_inning_to_start",
      });
    }));

  it("runs through a confirmed window that touches, not through a gap, a requested or another field's", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db, { withRules: false });
      const p = await permit(
        db,
        w,
        w.f1,
        at("00:00", "2026-11-15"),
        at("03:00", "2026-11-15"),
      );
      await permit(
        db,
        w,
        w.f1,
        at("03:00", "2026-11-15"),
        at("04:00", "2026-11-15"),
      );
      // After a gap, still requested, and on the other field: none count.
      await permit(
        db,
        w,
        w.f1,
        at("04:30", "2026-11-15"),
        at("05:30", "2026-11-15"),
      );
      await permit(
        db,
        w,
        w.f1,
        at("04:00", "2026-11-15"),
        at("05:00", "2026-11-15"),
        "requested",
      );
      await permit(
        db,
        w,
        w.f2,
        at("04:00", "2026-11-15"),
        at("09:00", "2026-11-15"),
      );
      const id = await play(db, w, w.f1, p);
      const info = (await permitInfoFor(db, [id])).get(id);
      expect(info?.permitEndsAt).toEqual(at("04:00", "2026-11-15"));
      // No division, so regulation length and the default rule.
      expect(info).toMatchObject({
        timeLimitMinutes: 90,
        innings: 7,
        rule: "call_at_last_complete",
      });
    }));

  it("reads a game's limits from its rule set, or regulation without one", () =>
    inRolledBackDb(async (db) => {
      const ruled = await world(db, { withRules: true });
      const plain = await world(db, { withRules: false });
      const withRules = await play(db, ruled, ruled.f1, null);
      const without = await play(db, plain, plain.f1, null);
      expect(await gameLimitsFor(db, withRules)).toEqual({
        innings: 5,
        timeLimitMinutes: 60,
        noNewInningMinutes: 5,
      });
      expect(await gameLimitsFor(db, without)).toEqual({
        innings: 7,
        timeLimitMinutes: 90,
        noNewInningMinutes: 10,
      });
    }));

  it("leaves out a game whose slot is not cut from a permit window, and takes no games", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db, { withRules: false });
      const id = await play(db, w, w.f1, null);
      expect((await permitInfoFor(db, [id])).size).toBe(0);
      expect((await permitInfoFor(db, [])).size).toBe(0);
    }));
});
