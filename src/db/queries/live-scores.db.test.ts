import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { TeamSeasonId, UserId } from "@/domain/ids";
import { lineScore } from "@/domain/scores/live";
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
  enterHalf,
  hasReferee,
  liveGame,
  reportFromInnings,
  setKicksFirst,
  snapshotOf,
  undoLastHalf,
} from "./live-scores";
import { respondToScore } from "./scores";
import { required } from "./rows";
import type { Db } from "./schedule";

afterAll(closePool);

const KICKOFF = new Date("2026-09-14T00:00:00Z");
const after = (minutes: number) =>
  new Date(KICKOFF.getTime() + minutes * 60_000);

const one = <T>(rows: T[], what: string) => required(rows[0], what);

/** Two teams, a ref and a game on a field, kicking off at KICKOFF. */
async function world(db: Db) {
  const tag = Math.random().toString(36).slice(2, 8);
  const people = await db
    .insert(user)
    .values(
      ["ref", "capA", "capB"].map((n) => ({
        name: n,
        email: `live-${n}-${tag}@example.test`,
      })),
    )
    .returning({ id: user.id });
  const [ref, capA, capB] = people.map((p) => p.id) as [UserId, UserId, UserId];
  const lg = one(
    await db
      .insert(league)
      .values({ name: "Test League", slug: `live-${tag}` })
      .returning({ id: league.id }),
    "league",
  );
  const sn = one(
    await db
      .insert(season)
      .values({
        leagueId: lg.id,
        name: "Fall",
        slug: "fall",
        status: "in_progress",
        startsOn: "2026-09-01",
        endsOn: "2026-11-01",
        feeModel: "per_player",
        playerFeeCents: 8500,
        rosterMin: 12,
        rosterMax: 20,
      })
      .returning({ id: season.id }),
    "season",
  );
  const vn = one(
    await db
      .insert(venue)
      .values({ leagueId: lg.id, name: "Park", slug: "park" })
      .returning({ id: venue.id }),
    "venue",
  );
  const fd = one(
    await db
      .insert(field)
      .values({ venueId: vn.id, name: "Field 1" })
      .returning({ id: field.id }),
    "field",
  );
  const sl = one(
    await db
      .insert(slot)
      .values({
        seasonId: sn.id,
        fieldId: fd.id,
        startsAt: KICKOFF,
        endsAt: after(60),
        timeIndex: 0,
      })
      .returning({ id: slot.id }),
    "slot",
  );
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
  const entries = await db
    .insert(teamSeason)
    .values(teams.map((t) => ({ teamId: t.id, seasonId: sn.id })))
    .returning({ id: teamSeason.id });
  const [a, b] = entries.map((e) => e.id) as [TeamSeasonId, TeamSeasonId];
  const g = one(
    await db
      .insert(game)
      .values({ seasonId: sn.id, teamAId: a, teamBId: b, slotId: sl.id })
      .returning({ id: game.id }),
    "game",
  );
  return { ref, capA, capB, a, b, gameId: g.id };
}

type World = Awaited<ReturnType<typeof world>>;

/** Saves halves in order from runs listed top, bottom, top, bottom… */
async function play(db: Db, w: World, runs: number[], from = 0) {
  for (const [i, r] of runs.entries()) {
    const index = from + i;
    const saved = await enterHalf(db, {
      gameId: w.gameId,
      userId: w.ref,
      inning: Math.floor(index / 2) + 1,
      half: index % 2 === 0 ? "top" : "bottom",
      runs: r,
      now: after(10 + index),
    });
    expect(saved.ok).toBe(true);
  }
}

describe("live scoring", () => {
  it("needs the game to have started and someone kicking first", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const half = { gameId: w.gameId, userId: w.ref, inning: 1 };
      expect(
        await enterHalf(db, { ...half, half: "top", runs: 1, now: after(-5) }),
      ).toEqual({ ok: false, error: "not_started" });
      expect(
        await enterHalf(db, { ...half, half: "top", runs: 1, now: after(5) }),
      ).toEqual({ ok: false, error: "no_kicks_first" });
      expect(
        await setKicksFirst(db, { gameId: w.gameId, side: "B", now: after(1) }),
      ).toMatchObject({ ok: true });
      const [row] = await db
        .select({ kicksFirst: game.kicksFirst })
        .from(game)
        .where(eq(game.id, w.gameId));
      expect(row?.kicksFirst).toBe(w.b);
    });
  });

  it("enters halves in order and builds the line score", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await setKicksFirst(db, { gameId: w.gameId, side: "A", now: after(1) });
      await play(db, w, [1, 0, 2]);
      const live = required(await liveGame(db, w.gameId), "live");
      expect(live.kicksFirst).toBe("A");
      expect(live.halves).toEqual([
        { inning: 1, half: "top", runs: 1 },
        { inning: 1, half: "bottom", runs: 0 },
        { inning: 2, half: "top", runs: 2 },
      ]);
      expect(lineScore(live.halves, "A")).toMatchObject({
        totalA: 3,
        totalB: 0,
        completeInnings: 1,
        next: { inning: 2, half: "bottom" },
      });
      // Skipping ahead is refused, and nothing is saved.
      expect(
        await enterHalf(db, {
          gameId: w.gameId,
          userId: w.ref,
          inning: 3,
          half: "top",
          runs: 4,
          now: after(30),
        }),
      ).toEqual({ ok: false, error: "out_of_order" });
      expect((await liveGame(db, w.gameId))?.halves).toHaveLength(3);
    });
  });

  it("corrects a half in place and takes back the last one", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await setKicksFirst(db, { gameId: w.gameId, side: "A", now: after(1) });
      await play(db, w, [1, 0, 2, 3]);
      // A captain corrects the top of the 1st; saving it twice is harmless.
      for (let i = 0; i < 2; i++)
        expect(
          await enterHalf(db, {
            gameId: w.gameId,
            userId: w.capA,
            inning: 1,
            half: "top",
            runs: 4,
            now: after(40),
          }),
        ).toMatchObject({ ok: true });
      const rows = await db
        .select({
          runs: gamePeriod.runs,
          enteredBy: gamePeriod.enteredBy,
        })
        .from(gamePeriod)
        .where(eq(gamePeriod.gameId, w.gameId));
      expect(rows).toHaveLength(4);
      expect(rows).toContainEqual({ runs: 4, enteredBy: w.capA });

      expect(
        await undoLastHalf(db, { gameId: w.gameId, now: after(41) }),
      ).toMatchObject({ ok: true });
      const live = required(await liveGame(db, w.gameId), "live");
      expect(live.halves.at(-1)).toEqual({ inning: 2, half: "top", runs: 2 });
      expect(lineScore(live.halves, "A")).toMatchObject({
        totalA: 6,
        totalB: 0,
      });
    });
  });

  it("reports a called game at the last complete inning, for confirmation", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await setKicksFirst(db, { gameId: w.gameId, side: "A", now: after(1) });
      // Three complete innings is too few for a called game to count.
      await play(db, w, [1, 0, 0, 2, 1, 1]);
      const end = (ending: "normal" | "called", clientId: string) =>
        reportFromInnings(db, {
          gameId: w.gameId,
          userId: w.ref,
          role: "referee",
          teamSeasonId: null,
          ending,
          clientId,
          now: after(70),
        });
      expect(await end("called", `early-${w.gameId}`)).toEqual({
        ok: false,
        error: "too_few_innings",
      });
      // Two more innings, then 4 runs in the top of the 6th before the rain.
      await play(db, w, [0, 0, 2, 0, 4], 6);
      const called = await end("called", `called-${w.gameId}`);
      expect(called).toMatchObject({ ok: true, value: { state: "awaiting" } });
      const [report] = await db
        .select({
          outcome: scoreReport.outcome,
          scoreA: scoreReport.scoreA,
          scoreB: scoreReport.scoreB,
          inningsPlayed: scoreReport.inningsPlayed,
          id: scoreReport.id,
        })
        .from(scoreReport)
        .where(eq(scoreReport.gameId, w.gameId));
      expect(report).toMatchObject({
        outcome: "called",
        scoreA: 4,
        scoreB: 3,
        inningsPlayed: 5,
      });

      // Spectators see the called score while it waits for confirmation.
      expect(
        snapshotOf(required(await liveGame(db, w.gameId), "live")),
      ).toMatchObject({
        closed: false,
        reported: true,
        pending: { scoreA: 4, scoreB: 3, inningsPlayed: 5 },
        result: null,
      });

      // A captain confirms; the game is final and closed to live entry.
      await respondToScore(db, {
        gameId: w.gameId,
        reportId: required(report, "report").id,
        teamSeasonId: w.b,
        userId: w.capB,
        status: "confirmed",
        note: "",
        now: after(80),
      });
      const live = required(await liveGame(db, w.gameId), "live");
      expect(snapshotOf(live)).toMatchObject({
        closed: true,
        pending: null,
        result: { scoreA: 4, scoreB: 3, inningsPlayed: 5 },
      });
      expect(
        await enterHalf(db, {
          gameId: w.gameId,
          userId: w.ref,
          inning: 6,
          half: "bottom",
          runs: 1,
          now: after(90),
        }),
      ).toEqual({ ok: false, error: "already_final" });
      expect(
        await undoLastHalf(db, { gameId: w.gameId, now: after(90) }),
      ).toEqual({ ok: false, error: "already_final" });
    });
  });

  it("reports every run for a game played to the end", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await setKicksFirst(db, { gameId: w.gameId, side: "B", now: after(1) });
      await play(db, w, [3, 1, 0, 2, 1]);
      expect(
        await reportFromInnings(db, {
          gameId: w.gameId,
          userId: w.capA,
          role: "captain",
          teamSeasonId: w.a,
          ending: "normal",
          clientId: `normal-${w.gameId}`,
          now: after(70),
        }),
      ).toMatchObject({ ok: true, value: { state: "awaiting" } });
      const [report] = await db
        .select({
          outcome: scoreReport.outcome,
          scoreA: scoreReport.scoreA,
          scoreB: scoreReport.scoreB,
        })
        .from(scoreReport)
        .where(eq(scoreReport.gameId, w.gameId));
      // B kicked first: tops are B's runs (3 + 0 + 1), bottoms A's (1 + 2).
      expect(report).toEqual({ outcome: "normal", scoreA: 3, scoreB: 4 });
    });
  });

  it("knows whether a ref has accepted the game", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      expect(await hasReferee(db, w.gameId)).toBe(false);
      await db
        .insert(refereeAssignment)
        .values({ gameId: w.gameId, userId: w.ref, status: "offered" });
      expect(await hasReferee(db, w.gameId)).toBe(false);
      await db
        .update(refereeAssignment)
        .set({ status: "accepted" })
        .where(eq(refereeAssignment.gameId, w.gameId));
      expect(await hasReferee(db, w.gameId)).toBe(true);
    });
  });

  it("keeps innings and runs in range in the database too", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      /** The constraint that rejects the row, or null if it is saved. */
      const rejectedBy = async (periodNo: number, runs: number) => {
        await db.execute(sql`savepoint bad_period`);
        try {
          await db
            .insert(gamePeriod)
            .values({ gameId: w.gameId, periodNo, half: "top", runs });
          return null;
        } catch (error) {
          const pgError = (error as { cause?: { constraint?: string } }).cause;
          return pgError?.constraint ?? "unknown";
        } finally {
          await db.execute(sql`rollback to savepoint bad_period`);
        }
      };
      expect(await rejectedBy(0, 1)).toBe("game_period_no_range");
      expect(await rejectedBy(21, 1)).toBe("game_period_no_range");
      expect(await rejectedBy(1, -1)).toBe("game_period_runs_range");
      expect(await rejectedBy(1, 100)).toBe("game_period_runs_range");
      expect(await rejectedBy(1, 99)).toBeNull();
    });
  });
});
