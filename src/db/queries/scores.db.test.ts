import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  type GameId,
  parseId,
  type ScoreReportId,
  type TeamSeasonId,
  type UserId,
} from "@/domain/ids";
import type { ScoreInput } from "@/domain/scores/scores";
import { auditLog } from "../schema/audit";
import { user } from "../schema/auth";
import { field, game, slot, venue } from "../schema/game";
import { league } from "../schema/league";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import { closePool, inRolledBackDb } from "../test/transaction";
import { required } from "./rows";
import type { Db } from "./schedule";
import {
  finalizeDueScores,
  reportScore,
  respondToScore,
  scoreHistories,
  scoreHistory,
  scoresNeedingAttention,
} from "./scores";

afterAll(closePool);

/** A report id from a score state, checked. */
const reportIdOf = (id: string): ScoreReportId =>
  required(parseId<ScoreReportId>(id), "report id");

const KICKOFF = new Date("2026-09-14T00:00:00Z");
const after = (hours: number) =>
  new Date(KICKOFF.getTime() + hours * 3_600_000);

async function world(db: Db) {
  const tag = Math.random().toString(36).slice(2, 8);
  const people = await db
    .insert(user)
    .values(
      ["capA", "capB", "admin"].map((n) => ({
        name: n,
        email: `score-${n}-${tag}@example.test`,
      })),
    )
    .returning({ id: user.id });
  const [capA, capB, admin] = people.map((p) => p.id) as [
    UserId,
    UserId,
    UserId,
  ];
  const lg = required(
    (
      await db
        .insert(league)
        .values({ name: "Test League", slug: `score-${tag}` })
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
          status: "in_progress",
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
          startsAt: KICKOFF,
          endsAt: after(1),
          timeIndex: 0,
        })
        .returning({ id: slot.id })
    )[0],
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
  const g = required(
    (
      await db
        .insert(game)
        .values({ seasonId: sn.id, teamAId: a, teamBId: b, slotId: sl.id })
        .returning({ id: game.id })
    )[0],
    "game",
  );
  return { capA, capB, admin, a, b, gameId: g.id, seasonId: sn.id, tag };
}

const score = (change: Partial<ScoreInput> = {}): ScoreInput => ({
  outcome: "normal",
  scoreA: 7,
  scoreB: 4,
  inningsPlayed: null,
  ...change,
});

const gameRow = async (db: Db, id: GameId) =>
  required(
    (
      await db
        .select({
          status: game.status,
          scoreA: game.scoreA,
          scoreB: game.scoreB,
          forfeitBy: game.forfeitBy,
          inningsPlayed: game.inningsPlayed,
        })
        .from(game)
        .where(eq(game.id, id))
    )[0],
    "game",
  );

describe("scores", () => {
  it("is final when the other captain confirms, and a repeat submit is a no-op", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const report = (clientId: string) =>
        reportScore(db, {
          gameId: w.gameId,
          userId: w.capA,
          role: "captain",
          teamSeasonId: w.a,
          score: score(),
          clientId,
          now: after(2),
        });
      const first = await report(`c1-${w.tag}`);
      expect(first).toMatchObject({ ok: true, value: { state: "awaiting" } });
      await report(`c1-${w.tag}`);
      const attention = await scoresNeedingAttention(db, w.seasonId, after(3));
      expect(attention.map((g) => [g.teams, g.state.state])).toEqual([
        ["Aces vs Bees", "awaiting"],
      ]);
      const reportId =
        first.ok && first.value.state === "awaiting"
          ? first.value.reportId
          : "";
      // The reporting team cannot settle its own score.
      expect(
        await respondToScore(db, {
          gameId: w.gameId,
          reportId: reportIdOf(reportId),
          teamSeasonId: w.a,
          userId: w.capA,
          status: "confirmed",
          note: "",
          now: after(3),
        }),
      ).toMatchObject({ ok: true, value: { state: "awaiting" } });
      expect(
        await respondToScore(db, {
          gameId: w.gameId,
          reportId: reportIdOf(reportId),
          teamSeasonId: w.b,
          userId: w.capB,
          status: "confirmed",
          note: "",
          now: after(3),
        }),
      ).toMatchObject({
        ok: true,
        value: { state: "final", reason: "confirmed" },
      });
      expect(await gameRow(db, w.gameId)).toMatchObject({
        status: "final",
        scoreA: 7,
        scoreB: 4,
      });
      expect(await scoresNeedingAttention(db, w.seasonId, after(4))).toEqual(
        [],
      );
      // Several games' histories at once match one at a time; a game with
      // no reports gets empty lists.
      const unreported = randomUUID() as GameId;
      const many = await scoreHistories(db, [w.gameId, unreported]);
      expect(many.get(w.gameId)).toEqual(await scoreHistory(db, w.gameId));
      expect(many.get(w.gameId)?.reports).toHaveLength(1);
      expect(many.get(unreported)).toEqual({ reports: [], responses: [] });
      // A captain cannot change a final score.
      expect(
        await reportScore(db, {
          gameId: w.gameId,
          userId: w.capB,
          role: "captain",
          teamSeasonId: w.b,
          score: score({ scoreB: 9 }),
          clientId: `c2-${w.tag}`,
          now: after(5),
        }),
      ).toEqual({ ok: false, error: "already_final" });
    });
  });

  it("stays open when disputed, finalizes undisputed scores after 24 hours, and lets an admin settle it", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const reported = await reportScore(db, {
        gameId: w.gameId,
        userId: w.capA,
        role: "captain",
        teamSeasonId: w.a,
        score: score(),
        clientId: `d1-${w.tag}`,
        now: after(2),
      });
      const reportId =
        reported.ok && reported.value.state === "awaiting"
          ? reported.value.reportId
          : "";
      expect(await finalizeDueScores(db, after(10))).toBe(0);
      await respondToScore(db, {
        gameId: w.gameId,
        reportId: reportIdOf(reportId),
        teamSeasonId: w.b,
        userId: w.capB,
        status: "disputed",
        note: "It was 7 to 5",
        now: after(3),
      });
      expect(await finalizeDueScores(db, after(48))).toBe(0);
      expect((await gameRow(db, w.gameId)).status).toBe("scheduled");
      const attention = await scoresNeedingAttention(db, w.seasonId, after(48));
      expect(attention[0]?.state.state).toBe("disputed");

      expect(
        await reportScore(db, {
          gameId: w.gameId,
          userId: w.admin,
          role: "admin",
          teamSeasonId: null,
          score: score({ scoreB: 5 }),
          clientId: `d2-${w.tag}`,
          now: after(49),
        }),
      ).toMatchObject({ ok: true, value: { state: "final", reason: "admin" } });
      expect(await gameRow(db, w.gameId)).toMatchObject({ scoreB: 5 });
      const audit = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.actorId, w.admin));
      expect(audit.map((a) => a.action)).toEqual(["score.override"]);
    });
  });

  it("finalizes a ref's undisputed score after a day, and records forfeits and called games", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await reportScore(db, {
        gameId: w.gameId,
        userId: w.capA,
        role: "referee",
        teamSeasonId: null,
        score: score({ outcome: "called", inningsPlayed: 5 }),
        clientId: `e1-${w.tag}`,
        now: after(2),
      });
      expect(await finalizeDueScores(db, after(27))).toBe(1);
      expect(await gameRow(db, w.gameId)).toMatchObject({
        status: "final",
        inningsPlayed: 5,
      });

      const w2 = await world(db);
      await reportScore(db, {
        gameId: w2.gameId,
        userId: w2.admin,
        role: "admin",
        teamSeasonId: null,
        score: score({ outcome: "forfeit_b" }),
        clientId: `e2-${w2.tag}`,
        now: after(2),
      });
      expect(await gameRow(db, w2.gameId)).toMatchObject({
        status: "forfeit",
        forfeitBy: w2.b,
        scoreA: null,
      });
    });
  });

  it("refuses a score before kickoff, an invalid score, and an unknown report", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const base = {
        gameId: w.gameId,
        userId: w.capA,
        role: "captain" as const,
        teamSeasonId: w.a,
        clientId: `f-${w.tag}`,
      };
      expect(
        await reportScore(db, { ...base, score: score(), now: after(-1) }),
      ).toEqual({
        ok: false,
        error: "not_started",
      });
      expect(
        await reportScore(db, {
          ...base,
          score: score({ scoreA: -2 }),
          now: after(2),
        }),
      ).toMatchObject({ ok: false, error: { scoreA: expect.any(String) } });
      expect(
        await respondToScore(db, {
          gameId: w.gameId,
          reportId: reportIdOf(randomUUID()),
          teamSeasonId: w.b,
          userId: w.capB,
          status: "confirmed",
          note: "",
          now: after(3),
        }),
      ).toEqual({ ok: false, error: "unknown_report" });
    });
  });
});
