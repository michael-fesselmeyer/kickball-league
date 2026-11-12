import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { parseId, type SeasonId, type UserId } from "@/domain/ids";
import { user } from "../schema/auth";
import { field, game, slot, venue } from "../schema/game";
import { league } from "../schema/league";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  assignReferee,
  gamesToReferee,
  refereeBoard,
  unassignReferee,
} from "./referees";
import { required } from "./rows";
import { loadSubject } from "./subject";

afterAll(closePool);

describe("referees", () => {
  it("assigns by email, replaces the old ref, and gives the ref the game's score rights", async () => {
    await inRolledBackDb(async (db) => {
      const tag = Math.random().toString(36).slice(2, 8);
      const people = await db
        .insert(user)
        .values(
          ["admin", "uma", "ray"].map((n) => ({
            name: n,
            email: `ref-${n}-${tag}@example.test`,
          })),
        )
        .returning({ id: user.id });
      const [admin, uma, ray] = people.map((p) => p.id) as [
        UserId,
        UserId,
        UserId,
      ];
      await db
        .insert(profile)
        .values(people.map((p) => ({ userId: p.id, firstName: "x" })));
      const lg = required(
        (
          await db
            .insert(league)
            .values({ name: "L", slug: `ref-${tag}` })
            .returning({ id: league.id })
        )[0],
        "league",
      );
      const sn = required(
        (
          await db
            .insert(season)
            .values({
              leagueId: lg.id,
              name: "Fall",
              slug: "fall",
              startsOn: "2026-09-01",
              endsOn: "2026-11-01",
              feeModel: "per_player",
              playerFeeCents: 8500,
              rosterMin: 12,
              rosterMax: 20,
            })
            .returning({ id: season.id })
        )[0],
        "season",
      );
      const vn = required(
        (
          await db
            .insert(venue)
            .values({ leagueId: lg.id, name: "Park", slug: "park" })
            .returning({ id: venue.id })
        )[0],
        "venue",
      );
      const fd = required(
        (
          await db
            .insert(field)
            .values({ venueId: vn.id, name: "Field 1" })
            .returning({ id: field.id })
        )[0],
        "field",
      );
      const sl = required(
        (
          await db
            .insert(slot)
            .values({
              seasonId: sn.id,
              fieldId: fd.id,
              startsAt: new Date("2026-09-14T00:00:00Z"),
              endsAt: new Date("2026-09-14T01:00:00Z"),
              timeIndex: 0,
            })
            .returning({ id: slot.id })
        )[0],
        "slot",
      );
      const teams = await db
        .insert(team)
        .values(
          ["Aces", "Bees"].map((n) => ({
            leagueId: lg.id,
            name: n,
            slug: `${n.toLowerCase()}-${tag}`,
          })),
        )
        .returning({ id: team.id });
      const [a, b] = await db
        .insert(teamSeason)
        .values(teams.map((t) => ({ teamId: t.id, seasonId: sn.id })))
        .returning({ id: teamSeason.id });
      const g = required(
        (
          await db
            .insert(game)
            .values({
              seasonId: sn.id,
              teamAId: required(a, "team").id,
              teamBId: required(b, "team").id,
              slotId: sl.id,
            })
            .returning({ id: game.id })
        )[0],
        "game",
      );

      expect(
        await assignReferee(db, {
          seasonId: sn.id,
          gameId: g.id,
          email: "nobody@example.test",
          actorId: admin,
        }),
      ).toEqual({ ok: false, error: "no_account" });
      await assignReferee(db, {
        seasonId: sn.id,
        gameId: g.id,
        email: ` REF-UMA-${tag}@example.test `,
        actorId: admin,
      });
      expect(await loadSubject(db, uma)).toMatchObject({
        isReferee: true,
        refereeGameIds: [g.id],
      });
      expect((await gamesToReferee(db, uma)).map((x) => x.teamAName)).toEqual([
        "Aces",
      ]);
      // Assigning someone else replaces Uma.
      await assignReferee(db, {
        seasonId: sn.id,
        gameId: g.id,
        email: `ref-ray-${tag}@example.test`,
        actorId: admin,
      });
      expect((await loadSubject(db, uma)).refereeGameIds).toEqual([]);
      expect((await refereeBoard(db, sn.id))[0]?.referee?.name).toBe("ray");
      await unassignReferee(db, {
        seasonId: sn.id,
        gameId: g.id,
        actorId: admin,
      });
      expect((await refereeBoard(db, sn.id))[0]?.referee).toBeNull();
      expect((await loadSubject(db, ray)).isReferee).toBe(false);
      expect(
        await assignReferee(db, {
          seasonId: required(parseId<SeasonId>(randomUUID()), "season id"),
          gameId: g.id,
          email: `ref-ray-${tag}@example.test`,
          actorId: admin,
        }),
      ).toEqual({ ok: false, error: "unknown_game" });
    });
  });
});
