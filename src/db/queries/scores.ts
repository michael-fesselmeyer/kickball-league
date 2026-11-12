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
  type ReporterRole,
  type ScoreErrors,
  type ScoreInput,
  scoreState,
  type ScoreState,
} from "@/domain/scores/scores";
import { user } from "../schema/auth";
import { field, game, scoreReport, scoreResponse, slot } from "../schema/game";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import { recordAudit } from "./audit";
import { advanceBracket } from "./playoffs";
import { required } from "./rows";
import type { Db } from "./schedule";

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
  const reports = await db
    .select({
      id: scoreReport.id,
      role: scoreReport.reporterRole,
      teamSeasonId: scoreReport.teamSeasonId,
      outcome: scoreReport.outcome,
      scoreA: scoreReport.scoreA,
      scoreB: scoreReport.scoreB,
      inningsPlayed: scoreReport.inningsPlayed,
      reportedAt: scoreReport.reportedAt,
      reporterName: user.name,
    })
    .from(scoreReport)
    .innerJoin(user, eq(scoreReport.reportedBy, user.id))
    .where(eq(scoreReport.gameId, gameId))
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
  return { reports, responses };
}

/** Where a game's score stands now, from its reports and responses. */
export async function currentScoreState(
  db: Db,
  g: Pick<ScoringGame, "id" | "teamAId" | "teamBId">,
  now: Date,
): Promise<{
  state: ScoreState;
  history: Awaited<ReturnType<typeof scoreHistory>>;
}> {
  const history = await scoreHistory(db, g.id);
  const state = scoreState(
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
  return { state, history };
}

/**
 * Writes the result to the game row when its score has become final, and
 * leaves it open otherwise. Safe to call any number of times.
 */
export async function settleGame(
  db: Db,
  gameId: GameId,
  now: Date,
): Promise<ScoreState> {
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
          }
        : {
            status: "final",
            forfeitBy: null,
            scoreA: report.scoreA,
            scoreB: report.scoreB,
            inningsPlayed: report.inningsPlayed,
            finalizedAt: now,
          },
    )
    .where(eq(game.id, gameId));
  // A playoff winner moves on as soon as the result is final.
  if (g.kind === "playoff") await advanceBracket(db, gameId, now);
  return state;
}

export type ReportError = "not_started" | "invalid" | "already_final";

/**
 * Records a reported score. A retried submit with the same client id is a
 * no-op, so a flaky connection at the field cannot report twice.
 */
export async function reportScore(
  db: Db,
  input: {
    gameId: GameId;
    userId: UserId;
    role: ReporterRole;
    teamSeasonId: TeamSeasonId | null;
    score: ScoreInput;
    clientId: string;
    now: Date;
  },
): Promise<Result<ScoreState, ReportError | ScoreErrors>> {
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
      clientId: input.clientId,
      reportedAt: input.now,
    })
    .onConflictDoNothing()
    .returning({ id: scoreReport.id });
  if (created && input.role === "admin")
    await recordAudit(db, {
      actorId: input.userId,
      action: "score.override",
      entityType: "game",
      entityId: input.gameId,
      after: { reportId: created.id, ...input.score },
    });
  return ok(await settleGame(db, input.gameId, input.now));
}

export type RespondError = "unknown_report" | "already_answered";

/** A captain confirms or disputes a report for their team. */
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
    .select({ id: scoreReport.id })
    .from(scoreReport)
    .where(
      and(
        eq(scoreReport.id, input.reportId),
        eq(scoreReport.gameId, input.gameId),
      ),
    );
  if (!report) return err("unknown_report");
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
    .returning({ id: scoreResponse.id });
  if (!created) return err("already_answered");
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
  for (const g of started) {
    const { state } = await currentScoreState(db, g, now);
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
