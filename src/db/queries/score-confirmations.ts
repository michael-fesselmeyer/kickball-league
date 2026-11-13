import { eq } from "drizzle-orm";
import type { ScoreReportId, TeamSeasonId } from "@/domain/ids";
import { respondingTeams } from "@/domain/scores/scores";
import {
  describeScore,
  type ScoreConfirmationPayload,
} from "@/emails/score-confirmation";
import { league } from "../schema/league";
import { season } from "../schema/season";
import { enqueueMessages, type OutboxMessage } from "./outbox";
import type { Db } from "./schedule";
import { captainsOf } from "./score-reminders";
import type { ScoringGame } from "./scores";

/**
 * Asks the captains who may answer a newly reported score to confirm or
 * dispute it (product-spec.md, "Scores"): the other team's captains for a
 * captain's report, both teams' for a ref's, nobody for an admin's (that
 * score is final at once). Queued in the report's own transaction; the
 * dedupe key names the report and the person, so a retried submit asks
 * once. Topic `score`, so it also comes as a push to captains who turned
 * that on. Returns how many were new.
 */
export async function queueScoreConfirmations(
  db: Db,
  g: Pick<
    ScoringGame,
    | "id"
    | "seasonId"
    | "teamAId"
    | "teamBId"
    | "teamAName"
    | "teamBName"
    | "startsAt"
    | "fieldName"
  >,
  report: {
    id: ScoreReportId;
    role: "referee" | "captain" | "admin";
    teamSeasonId: TeamSeasonId | null;
    reportedAt: Date;
    outcome: "normal" | "called" | "forfeit_a" | "forfeit_b";
    scoreA: number;
    scoreB: number;
    inningsPlayed: number | null;
  },
): Promise<number> {
  const teams = respondingTeams(report, [g.teamAId, g.teamBId]);
  if (teams.length === 0) return 0;
  const [captains, [place]] = await Promise.all([
    captainsOf(db, teams as TeamSeasonId[]),
    db
      .select({ timeZone: league.timezone })
      .from(season)
      .innerJoin(league, eq(season.leagueId, league.id))
      .where(eq(season.id, g.seasonId)),
  ]);
  if (captains.length === 0) return 0;
  const when = g.startsAt
    ? new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: place?.timeZone ?? "America/New_York",
      }).format(g.startsAt)
    : "time to be set";
  const payload = {
    gameId: g.id,
    teams: `${g.teamAName} vs ${g.teamBName}`,
    when: g.fieldName ? `${when}, ${g.fieldName}` : when,
    reportedBy:
      report.role === "referee"
        ? "The ref"
        : report.teamSeasonId === g.teamAId
          ? g.teamAName
          : g.teamBName,
    result: describeScore(report, g.teamAName, g.teamBName),
  } satisfies ScoreConfirmationPayload;
  const messages: OutboxMessage[] = captains.map((c) => ({
    userId: c.userId,
    topic: "score",
    template: "score_confirmation",
    payload,
    dedupeKey: `score-confirm/${report.id}/${c.userId}`,
    sendAfter: report.reportedAt,
  }));
  return enqueueMessages(db, messages);
}
