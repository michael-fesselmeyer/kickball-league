/**
 * Score rules (product-spec.md, "Game day"; rulebook 3.1.5).
 *
 * - A ref or a captain reports the final score; the other side confirms or
 *   disputes it. An admin's report is final at once.
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

/** Checks a reported score; forfeits ignore the runs. */
export function checkScore(input: ScoreInput): ScoreErrors {
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
 * Which teams may confirm or dispute a report: the other team for a
 * captain's, either team for a ref's, nobody for an admin's.
 */
export function respondingTeams(
  report: Report,
  teams: readonly [string, string],
): string[] {
  if (report.role === "captain")
    return teams.filter((t) => t !== report.teamSeasonId);
  return report.role === "referee" ? [...teams] : [];
}
