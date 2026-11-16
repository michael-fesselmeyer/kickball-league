import {
  aliasedTable,
  and,
  asc,
  desc,
  eq,
  inArray,
  lte,
  notInArray,
  or,
} from "drizzle-orm";
import type {
  GameId,
  ScoreReportId,
  SeasonId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import {
  checkScore,
  REASON_MAX,
  type ReporterRole,
  rulingKind,
  rulingNeedsReason,
  type ScoreErrors,
  type ScoreInput,
  scoreState,
  type ScoreState,
} from "@/domain/scores/scores";
import { describeScore } from "@/emails/score-confirmation";
import { user } from "../schema/auth";
import { field, game, scoreReport, scoreResponse, slot } from "../schema/game";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import { recordAudit } from "./audit";
import { advanceBracket } from "./playoffs";
import { required } from "./rows";
import {
  queueDisputeAlerts,
  queueRulingNotices,
  queueScoreConfirmations,
} from "./score-confirmations";
import { type Db, lockSchedulePublish } from "./schedule";

/**
 * Score entry and confirmation (roadmap week 5). Reports and responses are
 * append-only history; the game row holds the result once it is final.
 */

const teamA = aliasedTable(team, "team_a");
const teamB = aliasedTable(team, "team_b");
const entryA = aliasedTable(teamSeason, "entry_a");
const entryB = aliasedTable(teamSeason, "entry_b");

/** A game with its teams and slot, for the score screen. */
export async function gameForScoring(db: Db, gameId: GameId) {
  const [found] = await db
    .select({
      id: game.id,
      seasonId: game.seasonId,
      seasonSlug: season.slug,
      seasonName: season.name,
      kind: game.kind,
      status: game.status,
      teamAId: game.teamAId,
      teamBId: game.teamBId,
      teamAName: teamA.name,
      teamBName: teamB.name,
      scoreA: game.scoreA,
      scoreB: game.scoreB,
      inningsPlayed: game.inningsPlayed,
      forfeitBy: game.forfeitBy,
      ruledAt: game.ruledAt,
      startsAt: slot.startsAt,
      fieldName: field.name,
    })
    .from(game)
    .innerJoin(season, eq(game.seasonId, season.id))
    .innerJoin(entryA, eq(game.teamAId, entryA.id))
    .innerJoin(teamA, eq(entryA.teamId, teamA.id))
    .innerJoin(entryB, eq(game.teamBId, entryB.id))
    .innerJoin(teamB, eq(entryB.teamId, teamB.id))
    .leftJoin(slot, eq(game.slotId, slot.id))
    .leftJoin(field, eq(slot.fieldId, field.id))
    .where(eq(game.id, gameId));
  return found ?? null;
}

export type ScoringGame = NonNullable<
  Awaited<ReturnType<typeof gameForScoring>>
>;

/** Every report for a game, newest first, with the answers to each. */
export async function scoreHistory(db: Db, gameId: GameId) {
  return required((await scoreHistories(db, [gameId])).get(gameId), "history");
}

export type ScoreHistory =
  Awaited<ReturnType<typeof scoreHistories>> extends Map<GameId, infer H>
    ? H
    : never;

/**
 * `scoreHistory` for several games in two queries, whatever their number,
 * keyed by game. A game with no reports gets empty lists.
 */
export async function scoreHistories(db: Db, gameIds: readonly GameId[]) {
  const reports =
    gameIds.length === 0
      ? []
      : await db
          .select({
            gameId: scoreReport.gameId,
            id: scoreReport.id,
            role: scoreReport.reporterRole,
            teamSeasonId: scoreReport.teamSeasonId,
            outcome: scoreReport.outcome,
            scoreA: scoreReport.scoreA,
            scoreB: scoreReport.scoreB,
            inningsPlayed: scoreReport.inningsPlayed,
            reportedAt: scoreReport.reportedAt,
            reason: scoreReport.reason,
            reporterName: user.name,
          })
          .from(scoreReport)
          .innerJoin(user, eq(scoreReport.reportedBy, user.id))
          .where(inArray(scoreReport.gameId, [...gameIds]))
          .orderBy(desc(scoreReport.reportedAt));
  const responses =
    reports.length === 0
      ? []
      : await db
          .select({
            reportId: scoreResponse.scoreReportId,
            teamSeasonId: scoreResponse.teamSeasonId,
            status: scoreResponse.status,
            note: scoreResponse.note,
          })
          .from(scoreResponse)
          .where(
            inArray(
              scoreResponse.scoreReportId,
              reports.map((r) => r.id),
            ),
          );
  const gameOf = new Map(reports.map((r) => [r.id, r.gameId]));
  const result = new Map(
    gameIds.map((id) => [
      id,
      {
        reports: [] as Omit<(typeof reports)[number], "gameId">[],
        responses: [] as typeof responses,
      },
    ]),
  );
  for (const { gameId, ...report } of reports) {
    result.get(gameId)?.reports.push(report);
  }
  for (const response of responses) {
    const gameId = gameOf.get(response.reportId);
    if (gameId) result.get(gameId)?.responses.push(response);
  }
  return result;
}

/** Where a game's score stands now, from its reports and responses. */
export async function currentScoreState(
  db: Db,
  g: Pick<ScoringGame, "id" | "teamAId" | "teamBId">,
  now: Date,
): Promise<{
  state: ScoreState;
  history: ScoreHistory;
}> {
  const history = await scoreHistory(db, g.id);
  return { state: stateOf(g, history, now), history };
}

/** Where a game's score stands, from its already loaded history. */
function stateOf(
  g: Pick<ScoringGame, "teamAId" | "teamBId">,
  history: ScoreHistory,
  now: Date,
): ScoreState {
  return scoreState(
    history.reports.map((r) => ({
      id: r.id,
      role: r.role,
      teamSeasonId: r.teamSeasonId,
      reportedAt: r.reportedAt,
    })),
    history.responses,
    [g.teamAId, g.teamBId],
    now,
  );
}

/**
 * Writes the result to the game row when its score has become final, and
 * leaves it open otherwise. Safe to call any number of times.
 */
/**
 * Locks a game for a change to its score, until the transaction ends. A
 * playoff game first takes its season's publish lock, since its result can
 * publish the next round's game: always in that order, so two results
 * landing together take turns instead of deadlocking, and the second sees
 * the first's winner when it fills the next match.
 */
async function lockGameForScore(db: Db, gameId: GameId): Promise<void> {
  const [found] = await db
    .select({ seasonId: game.seasonId, kind: game.kind })
    .from(game)
    .where(eq(game.id, gameId));
  if (found?.kind === "playoff") await lockSchedulePublish(db, found.seasonId);
  await db
    .select({ id: game.id })
    .from(game)
    .where(eq(game.id, gameId))
    .for("update");
}

export async function settleGame(
  db: Db,
  gameId: GameId,
  now: Date,
): Promise<ScoreState> {
  await lockGameForScore(db, gameId);
  const g = required(await gameForScoring(db, gameId), "game");
  const { state, history } = await currentScoreState(db, g, now);
  if (state.state !== "final") return state;
  const report = required(
    history.reports.find((r) => r.id === state.reportId),
    "score report",
  );
  const forfeitBy =
    report.outcome === "forfeit_a"
      ? g.teamAId
      : report.outcome === "forfeit_b"
        ? g.teamBId
        : null;
  // A result an admin set with a written reason is a ruling; any later
  // result that is not one (a report that settled another way) clears it.
  const ruledAt =
    report.role === "admin" && report.reason ? report.reportedAt : null;
  await db
    .update(game)
    .set(
      forfeitBy
        ? {
            status: "forfeit",
            forfeitBy,
            scoreA: null,
            scoreB: null,
            inningsPlayed: null,
            finalizedAt: now,
            ruledAt,
          }
        : {
            status: "final",
            forfeitBy: null,
            scoreA: report.scoreA,
            scoreB: report.scoreB,
            inningsPlayed: report.inningsPlayed,
            finalizedAt: now,
            ruledAt,
          },
    )
    .where(eq(game.id, gameId));
  // A playoff winner moves on as soon as the result is final.
  if (g.kind === "playoff") await advanceBracket(db, gameId, now);
  return state;
}

/**
 * The result a ruling replaces, as players read it: the final score or
 * forfeit, else the latest report that was still open; null when there was
 * none.
 */
function previousResult(
  g: Pick<
    ScoringGame,
    | "status"
    | "teamAName"
    | "teamBName"
    | "teamAId"
    | "scoreA"
    | "scoreB"
    | "forfeitBy"
    | "inningsPlayed"
  >,
  latest:
    | {
        outcome: "normal" | "called" | "forfeit_a" | "forfeit_b";
        scoreA: number;
        scoreB: number;
        inningsPlayed: number | null;
      }
    | undefined,
): string | null {
  if (g.status === "forfeit" && g.forfeitBy)
    return `${g.forfeitBy === g.teamAId ? g.teamAName : g.teamBName} forfeited`;
  if (g.status === "final" && g.scoreA !== null && g.scoreB !== null)
    return describeScore(
      {
        outcome: g.inningsPlayed === null ? "normal" : "called",
        scoreA: g.scoreA,
        scoreB: g.scoreB,
        inningsPlayed: g.inningsPlayed,
      },
      g.teamAName,
      g.teamBName,
    );
  return latest ? describeScore(latest, g.teamAName, g.teamBName) : null;
}

export type ReportError =
  | "not_started"
  | "invalid"
  | "already_final"
  | "reason_needed"
  | "reason_too_long";

/**
 * Records a reported score. A retried submit with the same client id is a
 * no-op, so a flaky connection at the field cannot report twice. Run it in
 * a transaction: it locks the game.
 */
export async function reportScore(
  db: Db,
  input: {
    gameId: GameId;
    userId: UserId;
    role: ReporterRole;
    teamSeasonId: TeamSeasonId | null;
    score: ScoreInput;
    /**
     * An admin's written reason for a ruling. Required for a forfeit and
     * for any score that follows an earlier report or a final result; kept
     * only on an admin's report.
     */
    reason?: string | null;
    clientId: string;
    now: Date;
  },
): Promise<Result<ScoreState, ReportError | ScoreErrors>> {
  // One change to a game's score at a time, online, offline or an answer:
  // a report waits for a confirmation landing at the same moment, then
  // sees the game final.
  await lockGameForScore(db, input.gameId);
  const g = await gameForScoring(db, input.gameId);
  if (!g || (g.startsAt && g.startsAt > input.now)) return err("not_started");
  // Once final, only an admin may correct a score.
  if (
    (g.status === "final" || g.status === "forfeit") &&
    input.role !== "admin"
  )
    return err("already_final");
  const errors = checkScore(input.score, {
    tiesAllowed: g.kind !== "playoff",
  });
  if (Object.keys(errors).length > 0) return err(errors);
  const forfeit =
    input.score.outcome === "forfeit_a" || input.score.outcome === "forfeit_b";
  const reason =
    input.role === "admin" ? (input.reason?.trim() ?? "") || null : null;
  if (reason && reason.length > REASON_MAX) return err("reason_too_long");
  const closed = g.status === "final" || g.status === "forfeit";
  const earlier = input.role === "admin" ? await scoreHistory(db, g.id) : null;
  if (
    input.role === "admin" &&
    !reason &&
    rulingNeedsReason({
      outcome: input.score.outcome,
      hasReports: (earlier?.reports.length ?? 0) > 0,
      closed,
    })
  )
    return err("reason_needed");
  const [created] = await db
    .insert(scoreReport)
    .values({
      gameId: input.gameId,
      reportedBy: input.userId,
      reporterRole: input.role,
      teamSeasonId: input.teamSeasonId,
      outcome: input.score.outcome,
      scoreA: forfeit ? 0 : input.score.scoreA,
      scoreB: forfeit ? 0 : input.score.scoreB,
      inningsPlayed:
        input.score.outcome === "called" ? input.score.inningsPlayed : null,
      reason,
      clientId: input.clientId,
      reportedAt: input.now,
    })
    .onConflictDoNothing()
    .returning({ id: scoreReport.id });
  const ruling = created && reason ? rulingKind(input.score.outcome, g) : null;
  if (created && input.role === "admin")
    await recordAudit(db, {
      actorId: input.userId,
      action: ruling ? `game.${ruling}` : "score.override",
      entityType: "game",
      entityId: input.gameId,
      before: ruling
        ? {
            status: g.status,
            scoreA: g.scoreA,
            scoreB: g.scoreB,
            forfeitBy: g.forfeitBy,
          }
        : undefined,
      after: { reportId: created.id, ...input.score, reason },
    });
  const state = await settleGame(db, input.gameId, input.now);
  // Both captains and the ref are told about a ruling, and why.
  if (created && ruling && reason)
    await queueRulingNotices(db, g, {
      reportId: created.id,
      kind: ruling,
      reason,
      reportedAt: input.now,
      score: input.score,
      previously: previousResult(g, earlier?.reports[0]),
    });
  // A new report that still needs an answer asks the captains who can give it.
  if (created && state.state === "awaiting" && state.reportId === created.id)
    await queueScoreConfirmations(db, g, {
      id: created.id,
      role: input.role,
      teamSeasonId: input.teamSeasonId,
      reportedAt: input.now,
      outcome: input.score.outcome,
      scoreA: forfeit ? 0 : input.score.scoreA,
      scoreB: forfeit ? 0 : input.score.scoreB,
      inningsPlayed:
        input.score.outcome === "called" ? input.score.inningsPlayed : null,
    });
  return ok(state);
}

export type RespondError =
  "unknown_report" | "already_answered" | "already_final";

/**
 * A captain confirms or disputes a report for their team. Run it in a
 * transaction: it locks the game, so two captains answering at once settle
 * it one way, and an answer that arrives once the score is final (the other
 * team confirmed first, or the 24 hours ran out while the page sat open) is
 * refused rather than leaving a final game marked disputed.
 */
export async function respondToScore(
  db: Db,
  input: {
    gameId: GameId;
    reportId: ScoreReportId;
    teamSeasonId: TeamSeasonId;
    userId: UserId;
    status: "confirmed" | "disputed";
    note: string;
    now: Date;
  },
): Promise<Result<ScoreState, RespondError>> {
  const [report] = await db
    .select({
      id: scoreReport.id,
      role: scoreReport.reporterRole,
      teamSeasonId: scoreReport.teamSeasonId,
      outcome: scoreReport.outcome,
      scoreA: scoreReport.scoreA,
      scoreB: scoreReport.scoreB,
      inningsPlayed: scoreReport.inningsPlayed,
    })
    .from(scoreReport)
    .where(
      and(
        eq(scoreReport.id, input.reportId),
        eq(scoreReport.gameId, input.gameId),
      ),
    );
  if (!report) return err("unknown_report");
  await lockGameForScore(db, input.gameId);
  const g = required(await gameForScoring(db, input.gameId), "game");
  const { state } = await currentScoreState(db, g, input.now);
  if (state.state === "final") return err("already_final");
  const [created] = await db
    .insert(scoreResponse)
    .values({
      scoreReportId: input.reportId,
      teamSeasonId: input.teamSeasonId,
      userId: input.userId,
      status: input.status,
      note: input.note.trim().slice(0, 300) || null,
      respondedAt: input.now,
    })
    .onConflictDoNothing()
    .returning({ id: scoreResponse.id, note: scoreResponse.note });
  if (!created) return err("already_answered");
  if (input.status === "disputed")
    await queueDisputeAlerts(db, g, report, {
      id: created.id,
      teamSeasonId: input.teamSeasonId,
      note: created.note,
      respondedAt: input.now,
    });
  return ok(await settleGame(db, input.gameId, input.now));
}

/**
 * Finalizes every open game whose latest report has gone 24 hours without a
 * dispute. Run on a schedule; also safe to run on demand.
 */
export async function finalizeDueScores(db: Db, now: Date): Promise<number> {
  const open = await db
    .selectDistinct({ id: scoreReport.gameId })
    .from(scoreReport)
    .innerJoin(game, eq(scoreReport.gameId, game.id))
    .where(notInArray(game.status, ["final", "forfeit", "cancelled"]));
  let finalized = 0;
  for (const { id } of open)
    if ((await settleGame(db, id, now)).state === "final") finalized++;
  return finalized;
}

/**
 * What needs an admin's attention in a season: disputed scores, and games
 * whose slot has started with no score yet.
 */
export async function scoresNeedingAttention(
  db: Db,
  seasonId: SeasonId,
  now: Date,
) {
  const started = await db
    .select({
      id: game.id,
      startsAt: slot.startsAt,
      teamAName: teamA.name,
      teamBName: teamB.name,
      teamAId: game.teamAId,
      teamBId: game.teamBId,
    })
    .from(game)
    .innerJoin(slot, eq(game.slotId, slot.id))
    .innerJoin(entryA, eq(game.teamAId, entryA.id))
    .innerJoin(teamA, eq(entryA.teamId, teamA.id))
    .innerJoin(entryB, eq(game.teamBId, entryB.id))
    .innerJoin(teamB, eq(entryB.teamId, teamB.id))
    .where(
      and(
        eq(game.seasonId, seasonId),
        eq(game.status, "scheduled"),
        // A rained-out slot's game waits for a makeup, not a score.
        eq(slot.status, "open"),
        lte(slot.startsAt, now),
      ),
    )
    .orderBy(asc(slot.startsAt));
  const result: {
    id: GameId;
    startsAt: Date;
    teams: string;
    state: ScoreState;
  }[] = [];
  const histories = await scoreHistories(
    db,
    started.map((g) => g.id),
  );
  for (const g of started) {
    const state = stateOf(g, required(histories.get(g.id), "history"), now);
    result.push({
      id: g.id,
      startsAt: g.startsAt,
      teams: `${g.teamAName} vs ${g.teamBName}`,
      state,
    });
  }
  return result;
}

/** A team's games in its season, in date order, for the team page. */
export async function teamGames(db: Db, teamSeasonId: TeamSeasonId) {
  const rows = await db
    .select({
      id: game.id,
      kind: game.kind,
      status: game.status,
      teamAId: game.teamAId,
      teamBId: game.teamBId,
      teamAName: teamA.name,
      teamBName: teamB.name,
      scoreA: game.scoreA,
      scoreB: game.scoreB,
      forfeitBy: game.forfeitBy,
      startsAt: slot.startsAt,
      fieldName: field.name,
    })
    .from(game)
    .innerJoin(entryA, eq(game.teamAId, entryA.id))
    .innerJoin(teamA, eq(entryA.teamId, teamA.id))
    .innerJoin(entryB, eq(game.teamBId, entryB.id))
    .innerJoin(teamB, eq(entryB.teamId, teamB.id))
    .leftJoin(slot, eq(game.slotId, slot.id))
    .leftJoin(field, eq(slot.fieldId, field.id))
    .where(
      and(
        notInArray(game.status, ["cancelled"]),
        or(eq(game.teamAId, teamSeasonId), eq(game.teamBId, teamSeasonId)),
      ),
    )
    .orderBy(asc(slot.startsAt));
  return rows.map((r) => ({
    ...r,
    home: r.teamAId === teamSeasonId,
    opponent: r.teamAId === teamSeasonId ? r.teamBName : r.teamAName,
  }));
}
