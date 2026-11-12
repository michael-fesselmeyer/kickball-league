import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { GameId } from "@/domain/ids";
import { gameKey, type Schedule } from "@/domain/scheduler/types";
import { user } from "../schema/auth";
import { field, game, slot, venue } from "../schema/game";
import { league } from "../schema/league";
import { profile } from "../schema/profile";
import { scheduleVersion } from "../schema/schedule";
import { season } from "../schema/season";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  allPublishedGames,
  publicRoster,
  publishedGame,
  publishedGamesBetween,
  publishedGamesFor,
  publishedGamesForTeam,
  publishedSchedule,
  teamBySlug,
} from "./public-schedule";
import { required } from "./rows";
import {
  type Db,
  loadSchedulerInput,
  publishVersion,
  saveVersion,
} from "./schedule";

afterAll(closePool);

/** Four teams, one field, three Monday evening slots, in New York time. */
async function world(db: Db) {
  const tag = Math.random().toString(36).slice(2, 8);
  const admin = required(
    (
      await db
        .insert(user)
        .values({ name: "Admin", email: `pub-${tag}@example.test` })
        .returning({ id: user.id })
    )[0],
    "user",
  );
  const lg = required(
    (
      await db
        .insert(league)
        .values({ name: "Test League", slug: `pub-${tag}` })
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
          slug: `fall-${tag}`,
          status: "in_progress",
          startsOn: "2026-09-14",
          endsOn: "2026-11-02",
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
        .values({
          leagueId: lg.id,
          name: "Riverside Park",
          slug: "riverside-park",
          lat: "40.720000",
          lng: "-73.950000",
        })
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
  // 8, 9 and 10 pm EDT on Monday, September 14.
  const slots = await db
    .insert(slot)
    .values(
      ["00", "01", "02"].map((h, timeIndex) => {
        const startsAt = new Date(`2026-09-15T${h}:00:00Z`);
        return {
          seasonId: sn.id,
          fieldId: fd.id,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 55 * 60_000),
          timeIndex,
        };
      }),
    )
    .returning({ id: slot.id });
  const teams = await db
    .insert(team)
    .values(
      ["Aces", "Bees", "Cats", "Dogs"].map((name) => ({
        leagueId: lg.id,
        name,
        slug: `${name.toLowerCase()}-${tag}`,
      })),
    )
    .returning({ id: team.id, slug: team.slug });
  const entries = await db
    .insert(teamSeason)
    .values(teams.map((t) => ({ teamId: t.id, seasonId: sn.id })))
    .returning({ id: teamSeason.id });
  const [s1, s2, s3] = slots.map((s) => s.id);
  const [a, b, c, d] = entries.map((e) => e.id);
  if (!s1 || !s2 || !s3 || !a || !b || !c || !d) throw new Error("setup");
  return {
    tag,
    adminId: admin.id,
    seasonId: sn.id,
    slots: [s1, s2, s3] as const,
    entries: [a, b, c, d] as const,
    teams: teams.map((t) => ({ id: t.id, slug: t.slug })),
  };
}

const game1 = (a: string, b: string, slotId: string | null) => ({
  key: gameKey(1, a, b),
  round: 1,
  teamA: a,
  teamB: b,
  slotId,
});
const schedule = (games: Schedule["games"]): Schedule => ({
  games,
  byes: [],
  unplaced: [],
  diagnostics: [],
});

describe("published schedule queries", () => {
  it("read only the published version, never a draft", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const [s1, s2, s3] = w.slots;
      const [a, b, c, d] = w.entries;
      const input = await loadSchedulerInput(db, w.seasonId, {
        rounds: 1,
        reservePerDay: 0,
        seed: 1,
      });
      if (!input.ok) throw new Error(input.error);

      // Nothing is public before a version is published.
      const v1 = await saveVersion(db, {
        seasonId: w.seasonId,
        input: input.value,
        schedule: schedule([game1(a, b, s1), game1(c, d, s2)]),
        origin: "generated",
      });
      expect(await publishedSchedule(db, w.seasonId)).toEqual([]);

      const published = await publishVersion(db, v1, w.adminId);
      expect(published.ok).toBe(true);

      // A later draft moves A-B and adds a game nobody has published.
      await saveVersion(db, {
        seasonId: w.seasonId,
        input: input.value,
        schedule: schedule([
          game1(a, b, s3),
          game1(c, d, s2),
          { ...game1(a, c, s1), key: gameKey(2, a, c), round: 2 },
        ]),
        origin: "manual_edit",
        parentVersionId: v1,
      });

      const games = await publishedSchedule(db, w.seasonId);
      expect(
        games.map((g) => [
          g.teamA.name,
          g.teamB.name,
          g.startsAt?.toISOString(),
        ]),
      ).toEqual([
        ["Aces", "Bees", "2026-09-15T00:00:00.000Z"],
        ["Cats", "Dogs", "2026-09-15T01:00:00.000Z"],
      ]);
      expect(games[0]).toMatchObject({
        versionNo: 1,
        field: "Field 1",
        venue: { name: "Riverside Park", lat: 40.72, lng: -73.95 },
        slotCancelled: false,
      });

      // The draft-only game has no public page; a published one does.
      const draftOnly = required(
        (
          await db
            .select({ id: game.id })
            .from(game)
            .where(and(eq(game.seasonId, w.seasonId), eq(game.roundNo, 2)))
        ).find(() => true),
        "draft game",
      );
      expect(await publishedGame(db, draftOnly.id)).toBeNull();
      const one = await publishedGame(db, games[0]!.id as GameId);
      expect(one?.timeZone).toBe("America/New_York");
      expect(one?.game.startsAt?.toISOString()).toBe(
        "2026-09-15T00:00:00.000Z",
      );

      // A team's feed holds its own published games only.
      const aces = await publishedGamesForTeam(db, w.teams[0]!.id);
      expect(aces.map((g) => g.teamB.name)).toEqual(["Bees"]);

      // Head-to-head reads either order of the two slugs.
      const [acesSlug, beesSlug, catsSlug] = w.teams.map((t) => t.slug);
      const between = await publishedGamesBetween(db, beesSlug!, acesSlug!);
      expect(between.map((g) => g.teamA.name)).toEqual(["Aces"]);
      expect(await publishedGamesBetween(db, acesSlug!, catsSlug!)).toEqual([]);
      // One person's games: their team entries' and the ones they referee.
      const mine = await publishedGamesFor(db, {
        teamSeasonIds: [a],
        gameIds: [games[1]!.id as GameId],
      });
      expect(mine.map((g) => g.teamA.name)).toEqual(["Aces", "Cats"]);
      expect(
        await publishedGamesFor(db, { teamSeasonIds: [], gameIds: [] }),
      ).toEqual([]);
      const everything = await allPublishedGames(db);
      expect(everything.filter((g) => g.seasonId === w.seasonId)).toHaveLength(
        2,
      );

      // A season taken back to draft is not public at all.
      await db
        .update(season)
        .set({ status: "draft" })
        .where(eq(season.id, w.seasonId));
      expect(await publishedSchedule(db, w.seasonId)).toEqual([]);
      expect(await publishedGamesForTeam(db, w.teams[0]!.id)).toEqual([]);
    }));

  it("lists a published game the version left without a slot", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const [a, b, c, d] = w.entries;
      const input = await loadSchedulerInput(db, w.seasonId, {
        rounds: 1,
        reservePerDay: 0,
        seed: 1,
      });
      if (!input.ok) throw new Error(input.error);
      const v1 = await saveVersion(db, {
        seasonId: w.seasonId,
        input: input.value,
        schedule: schedule([game1(a, b, w.slots[1]), game1(c, d, null)]),
        origin: "generated",
      });
      // An unplaced game is a violation for the scheduler, so publish by hand.
      await db
        .update(scheduleVersion)
        .set({ status: "published", publishedAt: new Date() })
        .where(eq(scheduleVersion.id, v1));
      const games = await publishedSchedule(db, w.seasonId);
      expect(games.map((g) => [g.teamA.name, g.startsAt])).toEqual([
        ["Aces", expect.any(Date)],
        ["Cats", null],
      ]);
    }));
});

describe("teamBySlug and publicRoster", () => {
  it("finds a team's public seasons and shows only first names and initials", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const found = await teamBySlug(db, w.teams[0]!.slug);
      expect(found).toMatchObject({
        name: "Aces",
        timeZone: "America/New_York",
        entries: [{ id: w.entries[0], seasonName: "Fall" }],
      });
      expect(await teamBySlug(db, "no-such-team")).toBeNull();

      const people = await db
        .insert(user)
        .values(
          ["one", "two", "three", "four"].map((n) => ({
            name: n,
            email: `${n}-${w.tag}@example.test`,
          })),
        )
        .returning({ id: user.id });
      await db.insert(profile).values(
        people.map((p, i) => ({
          userId: p.id,
          firstName: ["Robin", "Alex", "Sam", null][i] ?? null,
          lastName: ["example", "Sample", null, "Nobody"][i] ?? null,
        })),
      );
      const regs = await db
        .insert(registration)
        .values(
          people.map((p) => ({
            seasonId: w.seasonId,
            userId: p.id,
            kind: "team_member" as const,
            status: "active" as const,
          })),
        )
        .returning({ id: registration.id });
      await db.insert(rosterMembership).values(
        regs.map((r, i) => ({
          teamSeasonId: w.entries[0],
          registrationId: r.id,
          role: i === 1 ? ("captain" as const) : ("player" as const),
          status: i === 2 ? ("invited" as const) : ("active" as const),
        })),
      );
      // The captain first; an invite that is not accepted and a person with
      // no first name are left out.
      expect(await publicRoster(db, w.entries[0])).toEqual([
        { name: "Alex S.", role: "captain" },
        { name: "Robin E.", role: "player" },
      ]);
    }));
});
