import {
  type CheckOptions,
  isForfeit,
  PLAYOFF_TIE,
  type ScoreErrors,
  type ScoreInput,
} from "./result";

/**
 * Dodgeball's score rules (ADR 0072). A match is best of N sets, N odd.
 *
 * - Played to the end: the winner has won a majority of the sets (3 of 5)
 *   and the loser fewer.
 * - Called early (the gym time ran out): neither team reached the
 *   majority, at least one set was played, and the sets stand as they are.
 *   A level called match is a tie, which the playoffs don't allow.
 * - A forfeit has no score; the other team wins.
 */

export const DEFAULT_BEST_OF = 5;
export const MAX_BEST_OF = 9;

/** Whether `n` is a match length a rule set may hold: odd, 1 to 9. */
export const isBestOf = (n: number) =>
  Number.isInteger(n) && n >= 1 && n <= MAX_BEST_OF && n % 2 === 1;

/** The match length to play: the rule set's, else the default. */
export const bestOfOr = (bestOf: number | null | undefined) =>
  bestOf != null && isBestOf(bestOf) ? bestOf : DEFAULT_BEST_OF;

/** Sets a team needs to win the match: 3 of 5. */
export const setsToWin = (bestOf: number) => Math.ceil(bestOf / 2);

export function checkDodgeballScore(
  input: ScoreInput,
  { tiesAllowed = true, bestOf }: CheckOptions = {},
): ScoreErrors {
  const errors: ScoreErrors = {};
  if (isForfeit(input.outcome)) return errors;
  const length = bestOfOr(bestOf);
  const need = setsToWin(length);
  const valid = (n: number) => Number.isInteger(n) && n >= 0 && n <= need;
  if (!valid(input.scoreA)) errors.scoreA = `Enter sets from 0 to ${need}.`;
  if (!valid(input.scoreB)) errors.scoreB = `Enter sets from 0 to ${need}.`;
  if (errors.scoreA || errors.scoreB) return errors;
  const high = Math.max(input.scoreA, input.scoreB);
  const low = Math.min(input.scoreA, input.scoreB);
  if (input.outcome === "normal" && !(high === need && low < need))
    errors.scoreB = `A match played to the end has one winner of ${need} sets (best of ${length}).`;
  else if (input.outcome === "called" && high >= need)
    errors.scoreB = `A team that won ${need} sets won the match: choose "Played to the end".`;
  else if (input.outcome === "called" && high === 0)
    errors.scoreB = "A match called before any set is finished isn't a result.";
  else if (!tiesAllowed && input.scoreA === input.scoreB)
    errors.scoreB = PLAYOFF_TIE;
  return errors;
}
