import { afterAll, describe, expect, it } from "vitest";
import type { GameId, TeamSeasonId } from "@/domain/ids";
import { user } from "../schema/auth";
import {
  field,
  game,
  gameRsvp,
  refereeAssignment,
  slot,
  venue,
} from "../schema/game";
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
  dashboardSeason,
  missingScores,
  nextGameDay,
  otherSeasons,
  registrationSummary,
} from "./admin-dashboard";
import { required } from "./rows";
import type { Db } from "./schedule";

afterAll(closePool);

/** Far enough ahead that no other data on a shared database gets in the way. */
const NOW = new Date("2099-06-05T16:00:00Z");

async function build(db: Db) {
  const tag = Math.random().toString(36).slice(2, 8);
  const lg = required(
    (
      await db
        .insert(league)
        .values({ name: "L", slug: `dash-${tag}` })
        .returning({ id: league.id })
    )[0],
    "league",
  );
  const [sn, draft] = await db
    .insert(season)
    .values(
      [
        { name: "Summer", slug: `dash-summer-${tag}`, status: "in_progress" },
        { name: "Fall", slug: `dash-fall-${tag}`, status: "draft" },
      ].map((s) => ({
        ...s,
        status: s.status as "in_progress" | "draft",
        leagueId: lg.id,
        startsOn: s.status === "draft" ? "2099-09-01" : "2099-05-01",
        endsOn: s.status === "draft" ? "2099-11-01" : "2099-08-01",
        feeModel: "per_player" as const,
        playerFeeCents: 8500,
        rosterMin: 1,
        rosterMax: 20,
      })),
    )
    .returning({ id: season.id, slug: season.slug });
  if (!sn || !draft) throw new Error("seasons missing");
  const vn = required(
    (
      await db
        .insert(venue)
        .values({ leagueId: lg.id, name: "Park", slug: `park-${tag}` })
        .returning({ id: venue.id })
    )[0],
    "venue",
  );
  const [f1, f2] = await db
    .insert(field)
    .values([
      { venueId: vn.id, name: "Field 1" },
      { venueId: vn.id, name: "Field 2" },
    ])
    .returning({ id: field.id });
  if (!f1 || !f2) throw new Error("fields missing");
  const teams = await db
    .insert(team)
    .values(
      ["Aces", "Bees", "Cats", "Dogs"].map((n) => ({
        leagueId: lg.id,
        name: n,
        slug: `${n.toLowerCase()}-${tag}`,
      })),
    )
    .returning({ id: team.id });
  const [aces, bees, cats, dogs] = (
    await db
      .insert(teamSeason)
      .values(teams.map((t) => ({ teamId: t.id, seasonId: sn.id })))
      .returning({ id: teamSeason.id })
  ).map((e) => e.id);
  if (!aces || !bees || !cats || !dogs) throw new Error("teams missing");

  let timeIndex = 0;
  const addGame = async (
    startsAt: string,
    fieldId: typeof f1.id,
    teamAId: TeamSeasonId,
    teamBId: TeamSeasonId,
    extra: { slotStatus?: "cancelled"; final?: boolean } = {},
  ): Promise<GameId> => {
    const start = new Date(startsAt);
    const sl = required(
      (
        await db
          .insert(slot)
          .values({
            seasonId: sn.id,
            fieldId,
            startsAt: start,
            endsAt: new Date(start.getTime() + 55 * 60_000),
            timeIndex: timeIndex++,
            status: extra.slotStatus ?? "open",
          })
          .returning({ id: slot.id })
      )[0],
      "slot",
    );
    const g = required(
      (
        await db
          .insert(game)
          .values({
            seasonId: sn.id,
            teamAId,
            teamBId,
            slotId: sl.id,
            ...(extra.final
              ? { status: "final", scoreA: 5, scoreB: 3, finalizedAt: start }
              : {}),
          })
          .returning({ id: game.id })
      )[0],
      "game",
    );
    return g.id;
  };

  // Last week: one game with no score, one final.
  const unscored = await addGame("2099-06-01T23:00:00Z", f1.id, aces, bees);
  await addGame("2099-06-01T23:00:00Z", f2.id, cats, dogs, { final: true });
  // Rained out on June 6 and waiting for a makeup: not the next game day.
  await addGame("2099-06-06T23:00:00Z", f1.id, aces, cats, {
    slotStatus: "cancelled",
  });
  // The next game day, June 8 in New York: 7 pm on Field 1, 10 pm on
  // Field 2 (already June 9 in UTC).
  const early = await addGame("2099-06-08T23:00:00Z", f1.id, aces, bees);
  const late = await addGame("2099-06-09T02:00:00Z", f2.id, cats, dogs);
  await addGame("2099-06-15T23:00:00Z", f1.id, aces, dogs);

  // The 7 pm game has a ref.
  const ref = required(
    (
      await db
        .insert(user)
        .values({ name: "Rae Ref", email: `dash-ref-${tag}@example.test` })
        .returning({ id: user.id })
    )[0],
    "ref",
  );
  await db
    .insert(refereeAssignment)
    .values({ gameId: early, userId: ref.id, status: "accepted" });

  // Aces: six women and five men, all in for the 7 pm game. Three paid,
  // two have not signed the waiver. Bees have nobody on the roster.
  const groups = [
    ...Array<"woman">(6).fill("woman"),
    ...Array<"man">(5).fill("man"),
  ];
  const people = await db
    .insert(user)
    .values(
      [...groups, "free agent"].map((_, i) => ({
        name: `p${i}`,
        email: `dash-${i}-${tag}@example.test`,
      })),
    )
    .returning({ id: user.id });
  await db.insert(profile).values(
    people.map((p, i) => ({
      userId: p.id,
      lineupGender: groups[i] ?? null,
    })),
  );
  for (const [i, p] of people.entries()) {
    const freeAgent = i === groups.length;
    const r = required(
      (
        await db
          .insert(registration)
          .values({
            seasonId: sn.id,
            userId: p.id,
            kind: freeAgent ? "free_agent" : "team_member",
            status:
              freeAgent || i < 2
                ? "pending_waiver"
                : i < 8
                  ? "pending_payment"
                  : "active",
          })
          .returning({ id: registration.id })
      )[0],
      "registration",
    );
    if (freeAgent) continue;
    await db.insert(rosterMembership).values({
      teamSeasonId: aces,
      registrationId: r.id,
      status: "active",
    });
    await db.insert(gameRsvp).values({
      gameId: early,
      userId: p.id,
      teamSeasonId: aces,
      status: "in",
    });
  }

  return { sn, draft, aces, bees, cats, dogs, unscored, early, late };
}

describe("admin dashboard", () => {
  it("opens on the season with the next game, or the latest past draft", async () => {
    await inRolledBackDb(async (db) => {
      const { sn, draft } = await build(db);
      expect((await dashboardSeason(db, NOW))?.slug).toBe(sn.slug);
      expect((await dashboardSeason(db, NOW, draft.slug))?.slug).toBe(
        draft.slug,
      );
      expect(await dashboardSeason(db, NOW, "no-such-season")).toBeNull();
      // Nothing left to play: the in-progress season beats the later draft.
      expect(
        (await dashboardSeason(db, new Date("2100-01-01T00:00:00Z")))?.slug,
      ).toBe(sn.slug);
      expect((await otherSeasons(db, sn.id)).map((s) => s.slug)).toContain(
        draft.slug,
      );
    });
  });

  it("shows the next game day with refs and RSVP fielding warnings", async () => {
    await inRolledBackDb(async (db) => {
      const { sn, aces, bees, early, late } = await build(db);
      const current = { id: sn.id, timeZone: "America/New_York" };
      const day = required(await nextGameDay(db, current, NOW), "game day");
      expect(day.date).toBe("2099-06-08");
      expect(day.games.map((g) => [g.id, g.fieldName])).toEqual([
        [early, "Field 1"],
        [late, "Field 2"],
      ]);
      expect(day.fields).toBe(2);
      expect(day.games[0]?.referee).toEqual({ name: "Rae Ref" });
      expect(day.games[1]?.referee).toBeNull();
      expect(day.withoutReferee).toBe(1);

      const [a, b] = required(day.games[0], "early game").teams;
      expect(a).toMatchObject({ teamSeasonId: aces, name: "Aces" });
      expect(a.rsvps).toMatchObject({ in: 11, noAnswer: 0 });
      expect(a.rsvps.fielding.level).toBe("full");
      expect(b).toMatchObject({ teamSeasonId: bees, name: "Bees" });
      expect(b.rsvps.fielding.level).toBe("forfeit");
      // Bees, Cats and Dogs have nobody in.
      expect(day.fieldingWarnings).toBe(3);

      // On the game day itself, it is still the next game day.
      expect(
        (await nextGameDay(db, current, new Date("2099-06-09T01:00:00Z")))
          ?.date,
      ).toBe("2099-06-08");
      // After the last game day there is none.
      expect(
        await nextGameDay(db, current, new Date("2099-06-16T12:00:00Z")),
      ).toBeNull();
    });
  });

  it("lists past games still missing a final score, not today's", async () => {
    await inRolledBackDb(async (db) => {
      const { sn, unscored } = await build(db);
      const current = { id: sn.id, timeZone: "America/New_York" };
      const missing = await missingScores(db, current, NOW);
      expect(missing.map((g) => [g.id, g.teams, g.state.state])).toEqual([
        [unscored, "Aces vs Bees", "none"],
      ]);
      // Mid-game on June 8, that day's games are not missing yet, and the
      // June 6 game was rained out, so it waits for a makeup, not a score.
      const during = await missingScores(
        db,
        current,
        new Date("2099-06-09T02:30:00Z"),
      );
      expect(during.map((g) => g.id)).toEqual([unscored]);
    });
  });

  it("counts registrations, payments and waivers by team", async () => {
    await inRolledBackDb(async (db) => {
      const { sn } = await build(db);
      const summary = await registrationSummary(db, sn.id);
      expect(
        summary.teams.map((t) => [t.name, t.players, t.paid, t.signed]),
      ).toEqual([
        ["Aces", 11, 3, 9],
        ["Bees", 0, 0, 0],
        ["Cats", 0, 0, 0],
        ["Dogs", 0, 0, 0],
      ]);
      expect(summary.freeAgents).toEqual({ players: 1, paid: 0, signed: 0 });
      expect(summary.totals).toEqual({ players: 12, paid: 3, signed: 9 });
    });
  });
});
