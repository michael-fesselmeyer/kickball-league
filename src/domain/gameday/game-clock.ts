import { ordinal, type Position, REGULATION_INNINGS } from "../scores/live";

/**
 * The game clock on the live scorer: how long a game has left in its time
 * limit, and when no new inning may start. Pure: the caller passes the
 * clock and the next half to be played.
 *
 * - A regulation game is 7 innings or 90 minutes, whichever comes first.
 *   A division's rule set can set its own numbers; a game with no rule set
 *   plays to regulation.
 * - No new inning starts in the last minutes of the time limit (10 unless
 *   the rule set says otherwise). An inning already under way is finished.
 * - The clock starts at the game's scheduled time. Long after the time
 *   limit, innings are being entered after the fact, so it says nothing.
 */

export const REGULATION_MINUTES = 90;
export const NO_NEW_INNING_MINUTES = 10;
/** The most an admin can set for the no-new-inning window. */
export const MAX_NO_NEW_INNING_MINUTES = 60;
/** Past the time limit by this much, the game is being entered after the fact. */
export const AFTER_THE_FACT_MINUTES = 60;

export type GameLimits = {
  /** Null when the rule set sets no number of innings. */
  innings: number | null;
  /** Null when the rule set sets no time limit. */
  timeLimitMinutes: number | null;
  /** Minutes before the time limit after which no new inning starts. */
  noNewInningMinutes: number;
};

/** The no-new-inning window a rule set's options pick, or the default. */
export function noNewInningMinutes(
  options: { noNewInningMinutes?: unknown } | null | undefined,
): number {
  const value = options?.noNewInningMinutes;
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_NO_NEW_INNING_MINUTES
    ? value
    : NO_NEW_INNING_MINUTES;
}

/**
 * A game's limits from its division's rule set; regulation when it has
 * none. A rule set that leaves innings or the time limit empty sets none.
 */
export function gameLimits(
  ruleSet: {
    innings: number | null;
    timeLimitMinutes: number | null;
    options: { noNewInningMinutes?: unknown } | null;
  } | null,
): GameLimits {
  if (!ruleSet)
    return {
      innings: REGULATION_INNINGS,
      timeLimitMinutes: REGULATION_MINUTES,
      noNewInningMinutes: NO_NEW_INNING_MINUTES,
    };
  return {
    innings: ruleSet.innings,
    timeLimitMinutes: ruleSet.timeLimitMinutes,
    noNewInningMinutes: noNewInningMinutes(ruleSet.options),
  };
}

export type ClockLevel =
  /** Time to play on. */
  | "running"
  /** Inside the last minutes: the inning under way is the last. */
  | "last_inning"
  /** Time is up, or no new inning may start: the game is over. */
  | "over";

export type Clock = { level: ClockLevel; minutesLeft: number; message: string };

const plural = (n: number) => `${n} minute${n === 1 ? "" : "s"}`;

/**
 * Where the game stands against its time limit, or null when there is
 * none, the game has not reached its start, every inning has been played,
 * or the time limit passed long ago. `next` is the next half to enter, null once none is left.
 */
export function gameClock(input: {
  startsAt: Date;
  now: Date;
  limits: GameLimits;
  next: Position | null;
}): Clock | null {
  const { limits, next } = input;
  if (limits.timeLimitMinutes === null || next === null) return null;
  if (limits.innings !== null && next.inning > limits.innings) return null;
  const elapsed = input.now.getTime() - input.startsAt.getTime();
  if (elapsed < 0) return null;
  const left = limits.timeLimitMinutes * 60_000 - elapsed;
  if (left < -AFTER_THE_FACT_MINUTES * 60_000) return null;
  const minutesLeft = Math.max(0, Math.ceil(left / 60_000));
  const window = limits.noNewInningMinutes;
  // The top of an inning is a new inning, except the very first.
  const startsInning = next.half === "top" && next.inning > 1;
  if (left <= window * 60_000) {
    if (startsInning)
      return {
        level: "over",
        minutesLeft,
        message:
          left <= 0
            ? `Time is up, so the ${ordinal(next.inning)} inning doesn't start. The game is over.`
            : `${plural(minutesLeft)} left, inside the last ${plural(window)}, so the ${ordinal(next.inning)} inning doesn't start. The game is over.`,
      };
    return {
      level: "last_inning",
      minutesLeft,
      message:
        left <= 0
          ? `Time is up. Finish the ${ordinal(next.inning)} inning; the game ends with it.`
          : `${plural(minutesLeft)} left. No new inning starts in the last ${plural(window)}, so the ${ordinal(next.inning)} is the last inning.`,
    };
  }
  return {
    level: "running",
    minutesLeft,
    message: `${plural(minutesLeft)} left on the game clock. No new inning starts in the last ${plural(window)}.`,
  };
}
