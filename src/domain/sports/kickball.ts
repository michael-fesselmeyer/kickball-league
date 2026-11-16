import {
  type CheckOptions,
  isForfeit,
  PLAYOFF_TIE,
  type ScoreErrors,
  type ScoreInput,
} from "./result";

/**
 * Kickball's score rules (product-spec.md, "Game day"; rulebook 3.1.5),
 * the league's first sport and the default (ADR 0087).
 *
 * - Scores are runs, 0 to 99 a team.
 * - A game called after at least 4 complete innings counts with the score
 *   at the last complete inning. Fewer innings is not a result (it is a
 *   rain-out, handled elsewhere).
 * - A forfeit has no score; the other team wins.
 */

export const MIN_CALLED_INNINGS = 4;
export const MAX_RUNS = 99;
/** Run difference counts at most 10 a game, so a blowout can't decide a tie. */
export const RUN_DIFFERENCE_CAP = 10;
/** The most innings a called game can report. */
export const MAX_INNINGS = 20;

const validRuns = (n: number) => Number.isInteger(n) && n >= 0 && n <= MAX_RUNS;

/**
 * Checks a reported score; forfeits ignore the runs. Playoff games cannot
 * end in a tie (rulebook 3.1.2), so the caller turns ties off for them.
 */
export function checkScore(
  input: ScoreInput,
  { tiesAllowed = true }: CheckOptions = {},
): ScoreErrors {
  const errors: ScoreErrors = {};
  if (isForfeit(input.outcome)) return errors;
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
      innings > MAX_INNINGS
    )
      errors.inningsPlayed = `A called game counts after ${MIN_CALLED_INNINGS} complete innings or more.`;
  }
  if (!tiesAllowed && !errors.scoreB && input.scoreA === input.scoreB)
    errors.scoreB = PLAYOFF_TIE;
  return errors;
}
