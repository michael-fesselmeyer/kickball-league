import { and, eq, inArray } from "drizzle-orm";
import type {
  ScoreReportId,
  ScoreResponseId,
  SeasonId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { respondingTeams } from "@/domain/scores/scores";
import {
  describeScore,
  type ScoreConfirmationPayload,
} from "@/emails/score-confirmation";
import type { ScoreDisputePayload } from "@/emails/score-dispute";
import { league, leagueMember } from "../schema/league";
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
  const [captains, place] = await Promise.all([
    captainsOf(db, teams as TeamSeasonId[]),
    seasonPlace(db, g),
  ]);
  if (captains.length === 0) return 0;
  const payload = {
    gameId: g.id,
    teams: `${g.teamAName} vs ${g.teamBName}`,
    when: whenAndWhere(g, place?.timeZone),
    reportedBy: reporterName(g, report),
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

type GameForMessages = Pick<
  ScoringGame,
  | "id"
  | "seasonId"
  | "teamAId"
  | "teamBId"
  | "teamAName"
  | "teamBName"
  | "startsAt"
  | "fieldName"
>;

type ReportForMessages = {
  role: "referee" | "captain" | "admin";
  teamSeasonId: TeamSeasonId | null;
  outcome: "normal" | "called" | "forfeit_a" | "forfeit_b";
  scoreA: number;
  scoreB: number;
  inningsPlayed: number | null;
};

/** The season's address and the league's time zone, for wording a game. */
async function seasonPlace(
  db: Db,
  g: Pick<ScoringGame, "seasonId">,
): Promise<{ slug: string; timeZone: string } | undefined> {
  const [place] = await db
    .select({ slug: season.slug, timeZone: league.timezone })
    .from(season)
    .innerJoin(league, eq(season.leagueId, league.id))
    .where(eq(season.id, g.seasonId));
  return place;
}

/** "Sun, Sep 13, 7:00 PM, Field 2", in the league's time zone. */
function whenAndWhere(
  g: Pick<ScoringGame, "startsAt" | "fieldName">,
  timeZone = "America/New_York",
): string {
  const when = g.startsAt
    ? new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone,
      }).format(g.startsAt)
    : "time to be set";
  return g.fieldName ? `${when}, ${g.fieldName}` : when;
}

function reporterName(
  g: Pick<ScoringGame, "teamAId" | "teamAName" | "teamBName">,
  report: Pick<ReportForMessages, "role" | "teamSeasonId">,
): string {
  if (report.role === "referee") return "The ref";
  if (report.role === "admin") return "An admin";
  return report.teamSeasonId === g.teamAId ? g.teamAName : g.teamBName;
}

/**
 * Everyone who can set a disputed score: the admins and owners of the
 * game's own league (ADR 0048).
 */
async function scoreAdmins(db: Db, seasonId: SeasonId): Promise<UserId[]> {
  const rows = await db
    .select({ id: leagueMember.userId })
    .from(leagueMember)
    .innerJoin(season, eq(season.leagueId, leagueMember.leagueId))
    .where(
      and(
        eq(season.id, seasonId),
        inArray(leagueMember.role, ["admin", "owner"]),
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * Tells every admin that a captain disputed a reported score
 * (roadmap, week 5: "a dispute alerts admins"), so a disputed game doesn't
 * sit unfinished until someone happens to open the Scores screen. Queued in
 * the dispute's own transaction; the dedupe key names the dispute and the
 * admin, so a retried submit tells each admin once. Topic `score`, urgent.
 * Returns how many were new.
 */
export async function queueDisputeAlerts(
  db: Db,
  g: GameForMessages,
  report: ReportForMessages,
  dispute: {
    id: ScoreResponseId;
    teamSeasonId: TeamSeasonId;
    note: string | null;
    respondedAt: Date;
  },
): Promise<number> {
  const [admins, place] = await Promise.all([
    scoreAdmins(db, g.seasonId),
    seasonPlace(db, g),
  ]);
  if (admins.length === 0 || !place) return 0;
  const payload = {
    gameId: g.id,
    seasonSlug: place.slug,
    teams: `${g.teamAName} vs ${g.teamBName}`,
    when: whenAndWhere(g, place.timeZone),
    result: describeScore(report, g.teamAName, g.teamBName),
    reportedBy: reporterName(g, report),
    disputedBy: dispute.teamSeasonId === g.teamAId ? g.teamAName : g.teamBName,
    ...(dispute.note ? { note: dispute.note } : {}),
  } satisfies ScoreDisputePayload;
  const messages: OutboxMessage[] = admins.map((userId) => ({
    userId,
    topic: "score",
    template: "score_dispute",
    payload,
    dedupeKey: `score-dispute/${dispute.id}/${userId}`,
    sendAfter: dispute.respondedAt,
  }));
  return enqueueMessages(db, messages);
}
