/**
 * Score rules (product-spec.md, "Game day"; rulebook 3.1.5).
 *
 * - A ref or a captain reports the final score; the other side confirms or
 *   disputes it. A ref who plays for one of the teams reports for that team,
 *   so the other team answers. An admin's report is final at once.
 * - A report nobody disputes becomes final 24 hours after it was made.
 * - A game called after at least 4 complete innings counts with the score at
 *   the last complete inning. Fewer innings is not a result (it is a
 *   rain-out, handled elsewhere).
 * - A forfeit has no score; the other team wins.
 *
 * Pure: the caller passes the time.
 */

export const OUTCOMES = ["normal", "called", "forfeit_a", "forfeit_b"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const MIN_CALLED_INNINGS = 4;
export const MAX_RUNS = 99;
export const AUTO_FINAL_HOURS = 24;
export const PLAYOFF_TIE = "Playoff games can't end in a tie. Play it out.";

/** The longest written reason for a ruling. */
export const REASON_MAX = 300;

/**
 * Whether an admin's score is a ruling that needs a written reason: any
 * forfeit, and any score that follows an earlier report or a final result
 * (settling a dispute, overriding a report, correcting or reversing a final
 * game or a forfeit). The first score an admin enters for a game nobody has
 * reported on is plain entry and needs none.
 */
export function rulingNeedsReason(input: {
  outcome: Outcome;
  /** Whether the game already has a score report. */
  hasReports: boolean;
  /** Whether the game already has a final result or a forfeit. */
  closed: boolean;
}): boolean {
  return (
    input.outcome === "forfeit_a" ||
    input.outcome === "forfeit_b" ||
    input.hasReports ||
    input.closed
  );
}

/** What an admin's ruling did, for the audit log and the messages. */
export type RulingKind = "forfeit" | "forfeit_reversed" | "ruling";

export function rulingKind(
  outcome: Outcome,
  before: { status: string },
): RulingKind {
  if (outcome === "forfeit_a" || outcome === "forfeit_b") return "forfeit";
  return before.status === "forfeit" ? "forfeit_reversed" : "ruling";
}

export type ScoreInput = {
  outcome: Outcome;
  scoreA: number;
  scoreB: number;
  inningsPlayed: number | null;
};

export type ScoreErrors = {
  scoreA?: string;
  scoreB?: string;
  inningsPlayed?: string;
};

const validRuns = (n: number) => Number.isInteger(n) && n >= 0 && n <= MAX_RUNS;

/**
 * Checks a reported score; forfeits ignore the runs. Playoff games cannot
 * end in a tie (rulebook 3.1.2), so the caller turns ties off for them.
 */
export function checkScore(
  input: ScoreInput,
  { tiesAllowed = true }: { tiesAllowed?: boolean } = {},
): ScoreErrors {
  const errors: ScoreErrors = {};
  if (input.outcome === "forfeit_a" || input.outcome === "forfeit_b")
    return errors;
  if (!validRuns(input.scoreA))
    errors.scoreA = `Enter runs from 0 to ${MAX_RUNS}.`;
  if (!validRuns(input.scoreB))
    errors.scoreB = `Enter runs from 0 to ${MAX_RUNS}.`;
  if (input.outcome === "called") {
    const innings = input.inningsPlayed;
    if (
      innings === null ||
      !Number.isInteger(innings) ||
      innings < MIN_CALLED_INNINGS ||
      innings > 20
    )
      errors.inningsPlayed = `A called game counts after ${MIN_CALLED_INNINGS} complete innings or more.`;
  }
  if (!tiesAllowed && !errors.scoreB && input.scoreA === input.scoreB)
    errors.scoreB = PLAYOFF_TIE;
  return errors;
}

export type ReporterRole = "referee" | "captain" | "admin";

export type Report = {
  id: string;
  role: ReporterRole;
  /** The team the reporting captain plays for; null for refs and admins. */
  teamSeasonId: string | null;
  reportedAt: Date;
};

export type Response = {
  reportId: string;
  teamSeasonId: string;
  status: "confirmed" | "disputed";
};

export type ScoreState =
  | { state: "none" }
  | { state: "awaiting"; reportId: string; finalAt: Date }
  | { state: "disputed"; reportId: string }
  | {
      state: "final";
      reportId: string;
      reason: "admin" | "confirmed" | "time";
    };

/**
 * Where a game's score stands, from its latest report and the responses to
 * it. Earlier reports are history: a new report starts the clock again.
 */
export function scoreState(
  reports: readonly Report[],
  responses: readonly Response[],
  teams: readonly [string, string],
  now: Date,
): ScoreState {
  const latest = [...reports].sort(
    (a, b) => b.reportedAt.getTime() - a.reportedAt.getTime(),
  )[0];
  if (!latest) return { state: "none" };
  if (latest.role === "admin")
    return { state: "final", reportId: latest.id, reason: "admin" };
  const mine = responses.filter((r) => r.reportId === latest.id);
  if (mine.some((r) => r.status === "disputed"))
    return { state: "disputed", reportId: latest.id };
  const confirmers = respondingTeams(latest, teams);
  if (
    mine.some(
      (r) => r.status === "confirmed" && confirmers.includes(r.teamSeasonId),
    )
  )
    return { state: "final", reportId: latest.id, reason: "confirmed" };
  const finalAt = new Date(
    latest.reportedAt.getTime() + AUTO_FINAL_HOURS * 3_600_000,
  );
  if (now >= finalAt)
    return { state: "final", reportId: latest.id, reason: "time" };
  return { state: "awaiting", reportId: latest.id, finalAt };
}

/**
 * Which teams may confirm or dispute a report: the other team for one from
 * a team's captain or from a ref who plays for a team in the game (the ref's
 * report counts as their team's), either team for a neutral ref's, nobody
 * for an admin's.
 */
export function respondingTeams(
  report: Report,
  teams: readonly [string, string],
): string[] {
  if (report.role === "admin") return [];
  if (report.teamSeasonId !== null && teams.includes(report.teamSeasonId))
    return teams.filter((t) => t !== report.teamSeasonId);
  return [...teams];
}

type Membership = { teamSeasonId: string; role: string };

const LEADS = ["captain", "co_captain"];

/**
 * The team a report counts for, stored with it. A captain's report is their
 * team's. A ref who plays for exactly one of the game's teams reports for
 * that team, so only the other team may answer it (issue #296). A ref on
 * both rosters, or neither, is neutral: either team may answer. Admins'
 * reports are final at once and count for no team.
 */
export function reportingTeam<T extends string>(
  role: ReporterRole,
  roster: readonly Membership[],
  teams: readonly [T, T],
): T | null {
  if (role === "admin") return null;
  if (role === "captain")
    return (
      teams.find((t) =>
        roster.some((m) => m.teamSeasonId === t && LEADS.includes(m.role)),
      ) ?? null
    );
  const plays = teams.filter((t) => roster.some((m) => m.teamSeasonId === t));
  return plays.length === 1 ? (plays[0] ?? null) : null;
}
