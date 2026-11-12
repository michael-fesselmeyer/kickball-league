import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { UserId } from "@/domain/ids";
import { user } from "../schema/auth";
import { game } from "../schema/game";
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
import { required } from "./rows";
import { myRsvps, setRsvp, teamRsvps } from "./rsvps";

afterAll(closePool);

describe("RSVPs", () => {
  it("records answers, counts them, and checks the fielding rule", async () => {
    await inRolledBackDb(async (db) => {
      const tag = Math.random().toString(36).slice(2, 8);
      const lg = required(
        (
          await db
            .insert(league)
            .values({ name: "L", slug: `rsvp-${tag}` })
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
              rosterMin: 1,
              rosterMax: 20,
            })
            .returning({ id: season.id })
        )[0],
        "season",
      );
      const teams = await db
        .insert(team)
        .values(
          ["Aces", "Bees", "Cats"].map((n) => ({
            leagueId: lg.id,
            name: n,
            slug: `${n.toLowerCase()}-${tag}`,
          })),
        )
        .returning({ id: team.id });
      const [aces, bees, cats] = (
        await db
          .insert(teamSeason)
          .values(teams.map((t) => ({ teamId: t.id, seasonId: sn.id })))
          .returning({ id: teamSeason.id })
      ).map((e) => e.id);
      if (!aces || !bees || !cats) throw new Error("teams missing");
      const g = required(
        (
          await db
            .insert(game)
            .values({ seasonId: sn.id, teamAId: aces, teamBId: bees })
            .returning({ id: game.id })
        )[0],
        "game",
      );

      // Eight Aces: four women, three men, one with no fielding group.
      const groups = [
        "woman",
        "woman",
        "woman",
        "woman",
        "man",
        "man",
        "man",
        null,
      ] as const;
      const people = await db
        .insert(user)
        .values(
          groups.map((_, i) => ({
            name: `p${i}`,
            email: `rsvp-${i}-${tag}@example.test`,
          })),
        )
        .returning({ id: user.id });
      await db.insert(profile).values(
        people.map((p, i) => ({
          userId: p.id,
          lineupGender: groups[i] ?? null,
        })),
      );
      for (const p of people) {
        const r = required(
          (
            await db
              .insert(registration)
              .values({ seasonId: sn.id, userId: p.id, kind: "team_member" })
              .returning({ id: registration.id })
          )[0],
          "registration",
        );
        await db.insert(rosterMembership).values({
          teamSeasonId: aces,
          registrationId: r.id,
          status: "active",
        });
      }
      const ids = people.map((p) => p.id);
      for (const id of ids)
        expect(
          await setRsvp(db, {
            gameId: g.id,
            userId: id,
            teamSeasonId: aces,
            status: "in",
          }),
        ).toEqual({ ok: true, value: undefined });
      // Changing an answer replaces it.
      await setRsvp(db, {
        gameId: g.id,
        userId: ids[0] as UserId,
        teamSeasonId: aces,
        status: "maybe",
      });

      const counts = (await teamRsvps(db, aces, [g.id])).get(g.id);
      expect(counts).toMatchObject({ in: 7, maybe: 1, out: 0, noAnswer: 0 });
      // Three women and three men coming: 6 fielders, a forfeit.
      expect(counts?.fielding).toMatchObject({ level: "forfeit", fielders: 6 });
      expect(counts?.fielding.message).toContain("1 more has not set");
      expect((await myRsvps(db, ids[0] as UserId, [g.id])).get(g.id)).toBe(
        "maybe",
      );

      // Not their game, and not after it is final.
      expect(
        await setRsvp(db, {
          gameId: g.id,
          userId: ids[1] as UserId,
          teamSeasonId: cats,
          status: "in",
        }),
      ).toEqual({ ok: false, error: "not_your_game" });
      await db
        .update(game)
        .set({ status: "final", scoreA: 1, scoreB: 0, finalizedAt: new Date() })
        .where(eq(game.id, g.id));
      expect(
        await setRsvp(db, {
          gameId: g.id,
          userId: ids[1] as UserId,
          teamSeasonId: aces,
          status: "out",
        }),
      ).toEqual({ ok: false, error: "game_over" });
      expect(await teamRsvps(db, aces, [])).toEqual(new Map());
      expect(await myRsvps(db, ids[1] as UserId, [])).toEqual(new Map());
    });
  });
});
