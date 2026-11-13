import { and, asc, eq, sql } from "drizzle-orm";
import type { GameId, TeamSeasonId, UserId } from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import {
  calledScore,
  checkHalf,
  type Half,
  type HalfError,
  type HalfInning,
  lineScore,
  type LiveSnapshot,
  type Side,
} from "@/domain/scores/live";
import type {
  ReporterRole,
  ScoreErrors,
  ScoreState,
} from "@/domain/scores/scores";
import {
  game,
  gamePeriod,
  refereeAssignment,
  scoreReport,
  slot,
} from "../schema/game";
import type { Db } from "./schedule";
import { type ReportError, reportScore } from "./scores";

/**
 * Inning-by-inning live scoring (docs/data-model.md, section 2.2). Halves are
 * saved one by one as the game goes; the final score still goes through
 * `reportScore` and the other captain's confirmation.
 */

const CLOSED = ["final", "forfeit", "cancelled"] as const;
type GameStatus = (typeof game.status.enumValues)[number];
const isClosed = (status: GameStatus) =>
  (CLOSED as readonly string[]).includes(status);

export type LiveGame = {
  id: GameId;
  status: GameStatus;
  teamAId: TeamSeasonId;
  teamBId: TeamSeasonId;
  /** Null until the scorer says who kicks first. */
  kicksFirst: Side | null;
  startsAt: Date | null;
  /** Set once the game is final: its official score. */
  scoreA: number | null;
  scoreB: number | null;
  /** Set for a called game: the innings that count. */
  inningsPlayed: number | null;
  /** When a half was last entered or corrected. */
  lastEntryAt: Date | null;
  /** The latest final score someone reported, confirmed or not. */
  latestReport: {
    outcome: "normal" | "called" | "forfeit_a" | "forfeit_b";
    scoreA: number;
    scoreB: number;
    inningsPlayed: number | null;
  } | null;
  halves: HalfInning[];
};

/** A game's live score: its halves so far, in one round trip. */
export async function liveGame(
  db: Db,
  gameId: GameId,
): Promise<LiveGame | null> {
  const rows = await db
    .select({
      id: game.id,
      status: game.status,
      teamAId: game.teamAId,
      teamBId: game.teamBId,
      kicksFirst: game.kicksFirst,
      scoreA: game.scoreA,
      scoreB: game.scoreB,
      inningsPlayed: game.inningsPlayed,
      startsAt: slot.startsAt,
      latestReport: sql<LiveGame["latestReport"]>`(
        select json_build_object(
          'outcome', ${scoreReport.outcome},
          'scoreA', ${scoreReport.scoreA},
          'scoreB', ${scoreReport.scoreB},
          'inningsPlayed', ${scoreReport.inningsPlayed}
        )
        from ${scoreReport}
        where ${scoreReport.gameId} = ${game.id}
        order by ${scoreReport.reportedAt} desc
        limit 1
      )`,
      inning: gamePeriod.periodNo,
      half: gamePeriod.half,
      runs: gamePeriod.runs,
      enteredAt: gamePeriod.enteredAt,
    })
    .from(game)
    .leftJoin(slot, eq(game.slotId, slot.id))
    .leftJoin(gamePeriod, eq(gamePeriod.gameId, game.id))
    .where(eq(game.id, gameId))
    // The half enum sorts top before bottom, so this is the order of play.
    .orderBy(asc(gamePeriod.periodNo), asc(gamePeriod.half));
  const first = rows[0];
  if (!first) return null;
  return {
    id: first.id,
    status: first.status,
    teamAId: first.teamAId,
    teamBId: first.teamBId,
    kicksFirst:
      first.kicksFirst === null
        ? null
        : first.kicksFirst === first.teamAId
          ? "A"
          : "B",
    startsAt: first.startsAt,
    scoreA: first.scoreA,
    scoreB: first.scoreB,
    inningsPlayed: first.inningsPlayed,
    latestReport: first.latestReport,
    lastEntryAt: rows.reduce<Date | null>(
      (latest, r) =>
        r.enteredAt && (!latest || r.enteredAt > latest) ? r.enteredAt : latest,
      null,
    ),
    halves: rows.flatMap((r) =>
      r.inning !== null && r.half !== null && r.runs !== null
        ? [{ inning: r.inning, half: r.half, runs: r.runs }]
        : [],
    ),
  };
}

/** What the public game page shows and polls for. */
export function snapshotOf(live: LiveGame): LiveSnapshot {
  const closed = isClosed(live.status);
  const report = live.latestReport;
  return {
    kicksFirst: live.kicksFirst,
    halves: live.halves,
    closed,
    reported: report !== null,
    lastEntryAt: live.lastEntryAt?.toISOString() ?? null,
    pending:
      !closed &&
      report &&
      (report.outcome === "normal" || report.outcome === "called")
        ? {
            scoreA: report.scoreA,
            scoreB: report.scoreB,
            inningsPlayed: report.inningsPlayed,
          }
        : null,
    result:
      live.status === "final" && live.scoreA !== null && live.scoreB !== null
        ? {
            scoreA: live.scoreA,
            scoreB: live.scoreB,
            inningsPlayed: live.inningsPlayed,
          }
        : null,
  };
}

/** Whether a ref has accepted this game; if so, only they score it live. */
export async function hasReferee(db: Db, gameId: GameId): Promise<boolean> {
  const [found] = await db
    .select({ id: refereeAssignment.id })
    .from(refereeAssignment)
    .where(
      and(
        eq(refereeAssignment.gameId, gameId),
        eq(refereeAssignment.status, "accepted"),
      ),
    )
    .limit(1);
  return found !== undefined;
}

export type LiveError =
  "not_found" | "not_started" | "already_final" | "no_kicks_first" | HalfError;

/** The game, locked against a second scorer, if it can be scored now. */
async function openGame(
  db: Db,
  gameId: GameId,
  now: Date,
): Promise<Result<LiveGame, LiveError>> {
  // Two phones saving the same half at once take turns.
  await db
    .select({ id: game.id })
    .from(game)
    .where(eq(game.id, gameId))
    .for("update");
  const live = await liveGame(db, gameId);
  if (!live) return err("not_found");
  if (isClosed(live.status)) return err("already_final");
  if (live.startsAt && live.startsAt > now) return err("not_started");
  return ok(live);
}

/** Records which team kicks in the top of each inning. */
export async function setKicksFirst(
  db: Db,
  input: { gameId: GameId; side: Side; now: Date },
): Promise<Result<LiveGame, LiveError>> {
  const open = await openGame(db, input.gameId, input.now);
  if (!open.ok) return open;
  const { teamAId, teamBId } = open.value;
  await db
    .update(game)
    .set({ kicksFirst: input.side === "A" ? teamAId : teamBId })
    .where(eq(game.id, input.gameId));
  return ok({ ...open.value, kicksFirst: input.side });
}

/**
 * Saves the runs of one half-inning: the next half in order, or a
 * correction to one already entered. Saving the same half twice is safe.
 */
export async function enterHalf(
  db: Db,
  input: {
    gameId: GameId;
    userId: UserId;
    inning: number;
    half: Half;
    runs: number;
    now: Date;
  },
): Promise<Result<LiveGame, LiveError>> {
  const open = await openGame(db, input.gameId, input.now);
  if (!open.ok) return open;
  const live = open.value;
  if (!live.kicksFirst) return err("no_kicks_first");
  const entry = { inning: input.inning, half: input.half, runs: input.runs };
  const problem = checkHalf(live.halves, entry, live.kicksFirst);
  if (problem) return err(problem);
  await db
    .insert(gamePeriod)
    .values({
      gameId: input.gameId,
      periodNo: input.inning,
      half: input.half,
      runs: input.runs,
      enteredBy: input.userId,
      enteredAt: input.now,
    })
    .onConflictDoUpdate({
      target: [gamePeriod.gameId, gamePeriod.periodNo, gamePeriod.half],
      set: { runs: input.runs, enteredBy: input.userId, enteredAt: input.now },
    });
  const others = live.halves.filter(
    (h) => !(h.inning === entry.inning && h.half === entry.half),
  );
  return ok({ ...live, halves: [...others, entry] });
}

/** Takes back the last half entered, for one saved by mistake. */
export async function undoLastHalf(
  db: Db,
  input: { gameId: GameId; now: Date },
): Promise<Result<LiveGame, LiveError>> {
  const open = await openGame(db, input.gameId, input.now);
  if (!open.ok) return open;
  const live = open.value;
  const last = live.halves.at(-1);
  if (!last) return ok(live);
  await db
    .delete(gamePeriod)
    .where(
      and(
        eq(gamePeriod.gameId, input.gameId),
        eq(gamePeriod.periodNo, last.inning),
        eq(gamePeriod.half, last.half),
      ),
    );
  return ok({ ...live, halves: live.halves.slice(0, -1) });
}

export type EndError =
  LiveError | ReportError | ScoreErrors | "too_few_innings" | "no_innings";

/**
 * Reports the final score from the innings entered: every run for a game
 * played to the end, or the score at the last complete inning for a called
 * game (rulebook 3.1.5). The report then waits for a captain's confirmation
 * like any other.
 */
export async function reportFromInnings(
  db: Db,
  input: {
    gameId: GameId;
    userId: UserId;
    role: ReporterRole;
    teamSeasonId: TeamSeasonId | null;
    ending: "normal" | "called";
    clientId: string;
    now: Date;
  },
): Promise<Result<ScoreState, EndError>> {
  const open = await openGame(db, input.gameId, input.now);
  if (!open.ok) return open;
  const live = open.value;
  if (!live.kicksFirst || live.halves.length === 0) return err("no_innings");
  let score;
  if (input.ending === "called") {
    const called = calledScore(live.halves, live.kicksFirst);
    if (!called) return err("too_few_innings");
    score = { outcome: "called" as const, ...called };
  } else {
    const { totalA, totalB } = lineScore(live.halves, live.kicksFirst);
    score = {
      outcome: "normal" as const,
      scoreA: totalA,
      scoreB: totalB,
      inningsPlayed: null,
    };
  }
  return reportScore(db, {
    gameId: input.gameId,
    userId: input.userId,
    role: input.role,
    teamSeasonId: input.teamSeasonId,
    score,
    clientId: input.clientId,
    now: input.now,
  });
}
