import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { commandState } from "@/domain/gameday/command-center";
import type { GameId, TeamSeasonId, UserId } from "@/domain/ids";
import { auditLog } from "../schema/audit";
import { user } from "../schema/auth";
import {
  field,
  game,
  gamePeriod,
  refereeAssignment,
  scoreReport,
  slot,
  venue,
} from "../schema/game";
import { league } from "../schema/league";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  checkInReferee,
  checkInRefereeFor,
  commandDate,
  commandRows,
} from "./command-center";
import { required } from "./rows";
import type { Db } from "./schedule";

afterAll(closePool);

const one = <T>(rows: T[], what: string) => required(rows[0], what);

/** 1 pm and 2 pm in New York on Saturday, November 14, 2026. */
const ONE_PM = new Date("2026-11-14T18:00:00Z");
const TWO_PM = new Date("2026-11-14T19:00:00Z");
const hourAfter = (d: Date) => new Date(d.getTime() + 3_600_000);

/**
 * A league in New York with two fields at one park. On Nov 14: a game with a
 * ref and two halves in, a game whose ref declined with a score reported,
 * a rained-out game, and a late game at 10:30 pm (already Nov 15 in UTC).
 * The busy ref also has a game on Nov 21, and a draft season has a game on
 * Nov 14 that nobody should see.
 */
async function world(db: Db) {
  const tag = Math.random().toString(36).slice(2, 8);
  const people = await db
    .insert(user)
    .values(
      ["Jamie Ref", "Robin Declined", "Casey Admin"].map((name, i) => ({
        name,
        email: `cc-${i}-${tag}@example.test`,
      })),
    )
    .returning({ id: user.id });
  const [ref, declined, admin] = people.map((p) => p.id) as [
    UserId,
    UserId,
    UserId,
  ];
  const lg = one(
    await db
      .insert(league)
      .values({ name: "Test League", slug: `cc-${tag}` })
      .returning({ id: league.id }),
    "league",
  );
  const seasons = await db
    .insert(season)
    .values(
      (["in_progress", "draft"] as const).map((status) => ({
        leagueId: lg.id,
        name: status,
        slug: `${status.replace("_", "-")}-${tag}`,
        status,
        startsOn: "2026-09-01",
        endsOn: "2026-12-01",
        feeModel: "per_player" as const,
        playerFeeCents: 8500,
        rosterMin: 1,
        rosterMax: 20,
      })),
    )
    .returning({ id: season.id });
  const [live, draft] = seasons.map((s) => s.id);
  if (!live || !draft) throw new Error("no seasons");
  const park = one(
    await db
      .insert(venue)
      .values({
        leagueId: lg.id,
        name: "Example Park",
        slug: `park-${tag}`,
        lat: "40.720000",
        lng: "-73.950000",
      })
      .returning({ id: venue.id }),
    "venue",
  );
  const fields = await db
    .insert(field)
    .values(["Field 1", "Field 2"].map((name) => ({ venueId: park.id, name })))
    .returning({ id: field.id });
  const [f1, f2] = fields.map((f) => f.id);
  if (!f1 || !f2) throw new Error("no fields");
  const teams = await db
    .insert(team)
    .values(
      ["Aces", "Bees", "Cats", "Dogs"].map((name) => ({
        leagueId: lg.id,
        name,
        slug: `${name.toLowerCase()}-${tag}`,
      })),
    )
    .returning({ id: team.id });
  const entry = async (seasonId: typeof live, i: number) =>
    one(
      await db
        .insert(teamSeason)
        .values({ teamId: required(teams[i], "team").id, seasonId })
        .returning({ id: teamSeason.id }),
      "entry",
    ).id;
  const [a, b, c, d] = [
    await entry(live, 0),
    await entry(live, 1),
    await entry(live, 2),
    await entry(live, 3),
  ];
  const draftA = await entry(draft, 0);
  const draftB = await entry(draft, 1);

  const place = async (
    seasonId: typeof live,
    fieldId: typeof f1,
    startsAt: Date,
    teamAId: TeamSeasonId,
    teamBId: TeamSeasonId,
    cancelled = false,
  ): Promise<GameId> => {
    const s = one(
      await db
        .insert(slot)
        .values({
          seasonId,
          fieldId,
          startsAt,
          endsAt: hourAfter(startsAt),
          timeIndex: 0,
          status: cancelled ? "cancelled" : "open",
        })
        .returning({ id: slot.id }),
      "slot",
    );
    return one(
      await db
        .insert(game)
        .values({ seasonId, teamAId, teamBId, slotId: s.id })
        .returning({ id: game.id }),
      "game",
    ).id;
  };
  const withRef = await place(live, f1, ONE_PM, a, b);
  const reported = await place(live, f2, ONE_PM, c, d);
  const rainedOut = await place(live, f1, TWO_PM, c, a, true);
  const late = await place(live, f2, new Date("2026-11-15T03:30:00Z"), b, d);
  const nextWeek = await place(
    live,
    f1,
    new Date("2026-11-21T18:00:00Z"),
    a,
    c,
  );
  await place(draft, f2, TWO_PM, draftA, draftB);

  await db.insert(refereeAssignment).values([
    { gameId: withRef, userId: ref },
    { gameId: late, userId: ref },
    { gameId: nextWeek, userId: ref },
    { gameId: reported, userId: declined, status: "declined" as const },
  ]);
  await db.insert(gamePeriod).values([
    { gameId: withRef, periodNo: 1, half: "top", runs: 2, enteredBy: ref },
    { gameId: withRef, periodNo: 1, half: "bottom", runs: 1, enteredBy: ref },
  ]);
  await db.insert(scoreReport).values({
    gameId: reported,
    reportedBy: admin,
    reporterRole: "admin",
    scoreA: 6,
    scoreB: 4,
    clientId: `cc-report-${tag}`,
  });
  return {
    leagueId: lg.id,
    ref,
    admin,
    games: { withRef, reported, rainedOut, late, nextWeek },
  };
}

describe("the game-day command center", () => {
  it("opens on today, else the next day with a game", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      // 7 am in New York on the 14th.
      expect(
        await commandDate(db, w.leagueId, new Date("2026-11-14T12:00:00Z")),
      ).toBe("2026-11-14");
      // 11 pm on the 14th in New York is already the 15th in UTC.
      expect(
        await commandDate(db, w.leagueId, new Date("2026-11-15T04:00:00Z")),
      ).toBe("2026-11-14");
      expect(
        await commandDate(db, w.leagueId, new Date("2026-11-16T12:00:00Z")),
      ).toBe("2026-11-21");
      expect(
        await commandDate(db, w.leagueId, new Date("2026-11-22T12:00:00Z")),
      ).toBeNull();
    });
  });

  it("reads every game of the day in league time, with refs, reports and halves", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const rows = await commandRows(db, w.leagueId, "2026-11-14");
      // The draft season's game and next week's are left out; the 10:30 pm
      // game belongs to the 14th.
      expect(rows.map((r) => r.id).sort()).toEqual(
        [
          w.games.withRef,
          w.games.reported,
          w.games.rainedOut,
          w.games.late,
        ].sort(),
      );
      const by = new Map(rows.map((r) => [r.id, r]));
      expect(by.get(w.games.withRef)).toMatchObject({
        fieldName: "Field 1",
        teamA: { name: "Aces" },
        referee: { name: "Jamie Ref", checkedInAt: null },
        report: null,
        venue: { lat: 40.72, lng: -73.95 },
      });
      expect(by.get(w.games.withRef)?.halves).toHaveLength(2);
      // A declined ref is no ref.
      expect(by.get(w.games.reported)).toMatchObject({
        referee: null,
        report: { scoreA: 6, scoreB: 4 },
      });
      expect(by.get(w.games.rainedOut)?.slotCancelled).toBe(true);

      const state = commandState(
        rows,
        "2026-11-14",
        new Date("2026-11-14T18:30:00Z"),
      );
      expect(state.games.map((g) => g.score)).toEqual([
        "live",
        "reported",
        "called_off",
        "upcoming",
      ]);
      expect(state.games[0]?.runs).toEqual({ a: 2, b: 1 });
      expect(state.counts).toMatchObject({
        games: 4,
        refsAssigned: 2,
        refsIn: 0,
      });
    });
  });

  it("checks a ref in to all of that day's games at once, once", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const first = new Date("2026-11-14T17:40:00Z");
      expect(
        await checkInReferee(db, {
          gameId: w.games.withRef,
          userId: w.ref,
          now: first,
        }),
      ).toBe(2);
      // Again later: nothing changes, and the first time stays.
      expect(
        await checkInReferee(db, {
          gameId: w.games.late,
          userId: w.ref,
          now: new Date("2026-11-14T20:00:00Z"),
        }),
      ).toBe(0);
      const rows = await db
        .select({
          gameId: refereeAssignment.gameId,
          checkedInAt: refereeAssignment.checkedInAt,
        })
        .from(refereeAssignment)
        .where(eq(refereeAssignment.userId, w.ref));
      const at = new Map(rows.map((r) => [r.gameId, r.checkedInAt]));
      expect(at.get(w.games.withRef)).toEqual(first);
      expect(at.get(w.games.late)).toEqual(first);
      // Next week's game is another day.
      expect(at.get(w.games.nextWeek)).toBeNull();
      // Someone who doesn't ref the game checks in to nothing.
      expect(
        await checkInReferee(db, {
          gameId: w.games.withRef,
          userId: w.admin,
          now: first,
        }),
      ).toBe(0);

      const state = commandState(
        await commandRows(db, w.leagueId, "2026-11-14"),
        "2026-11-14",
        new Date("2026-11-14T18:30:00Z"),
      );
      expect(state.counts).toMatchObject({ refsIn: 2, refsAssigned: 2 });
    });
  });

  it("lets an admin check a ref in for them, audited", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const now = new Date("2026-11-14T17:50:00Z");
      expect(
        await checkInRefereeFor(db, {
          gameId: w.games.withRef,
          actorId: w.admin,
          now,
        }),
      ).toBe(true);
      expect(
        await checkInRefereeFor(db, {
          gameId: w.games.withRef,
          actorId: w.admin,
          now,
        }),
      ).toBe(false);
      // No ref to check in.
      expect(
        await checkInRefereeFor(db, {
          gameId: w.games.reported,
          actorId: w.admin,
          now,
        }),
      ).toBe(false);
      const audits = await db
        .select({ action: auditLog.action, after: auditLog.after })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entityId, w.games.withRef),
            eq(auditLog.action, "referee.check_in"),
          ),
        );
      expect(audits).toEqual([
        { action: "referee.check_in", after: { refereeId: w.ref } },
      ]);
    });
  });
});
