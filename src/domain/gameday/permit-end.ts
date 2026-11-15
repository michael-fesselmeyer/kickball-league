/**
 * The permit-end watch (issue #406): how long a game has left in the permit
 * window of its field, and whether it will run past it. Pure: the caller
 * hands over the window saved with the game and a clock, so the same
 * answer works on the server and, from the window the page was loaded with,
 * on a phone with no signal.
 */

/** What the league's rules say happens when a game reaches the permit's end. */
export type PermitEndRule = "call_at_last_complete" | "last_inning_to_start";

/** Used when a rule set does not say. A called game keeps the score of its last complete inning. */
export const DEFAULT_PERMIT_END_RULE: PermitEndRule = "call_at_last_complete";

export const PERMIT_END_RULE_TEXT: Record<PermitEndRule, string> = {
  call_at_last_complete:
    "The game is called at the score of the last complete inning.",
  last_inning_to_start: "No new inning starts once the permit has ended.",
};

/** The rule a rule set's options pick, or the default. */
export function permitEndRule(
  options: { permitEndRule?: string | undefined } | null | undefined,
): PermitEndRule {
  const value = options?.permitEndRule;
  return value === "last_inning_to_start" || value === "call_at_last_complete"
    ? value
    : DEFAULT_PERMIT_END_RULE;
}

export type Span = { startsAt: Date; endsAt: Date };

/**
 * When the league's hold on the field ends for a game cut from `own`: the
 * end of `own`, pushed later through every window that begins at or before
 * the end so far (a permit entered in two halves, or two permits back to
 * back). A window with a gap before it does not count: the league does not
 * hold the field in the gap.
 */
export function permitEndFor(own: Span, held: readonly Span[]): Date {
  let end = own.endsAt.getTime();
  const sorted = [...held].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  );
  for (const w of sorted) {
    if (w.startsAt.getTime() <= end && w.endsAt.getTime() > end)
      end = w.endsAt.getTime();
  }
  return new Date(end);
}

export type WatchInput = {
  /** The end of the permit window saved with the game; null without one. */
  permitEndsAt: Date | null;
  now: Date;
  /** The game's slot start, when its clock starts. */
  startsAt: Date;
  /** The rule set's time limit in minutes, if it has one. */
  timeLimitMinutes: number | null;
  /** The rule set's number of innings, if it says. */
  innings: number | null;
  /** Half-innings entered so far. */
  halvesEntered: number;
  rule: PermitEndRule;
};

export type WatchLevel =
  /** Plenty of time. */
  | "ok"
  /** The time limit or the pace would carry the game past the permit's end. */
  | "watch"
  /** The permit has ended. */
  | "over";

export type Watch = {
  minutesLeft: number;
  level: WatchLevel;
  /** Why the game is on watch; null when it is not. */
  reason: "time_limit" | "pace" | "over" | null;
  /** The league's rule for this case, named for the ref and captains. */
  rule: string;
  /** One sentence for the screen. */
  message: string;
};

/** A pace needs a few half-innings before it says anything. */
const MIN_HALVES_FOR_PACE = 2;

const minutes = (ms: number) => Math.ceil(ms / 60_000);

const plural = (n: number) => `${n} minute${n === 1 ? "" : "s"}`;

/**
 * The state of a game against its permit's end, or null when no window is
 * saved with the game. The game's end is the earlier of its time limit
 * (from the slot's start) and its pace (the minutes so far per half-inning,
 * carried over the half-innings left); either one past the permit's end is
 * a warning.
 */
export function permitWatch(input: WatchInput): Watch | null {
  const { permitEndsAt, now } = input;
  if (!permitEndsAt) return null;
  const rule = PERMIT_END_RULE_TEXT[input.rule];
  const left = permitEndsAt.getTime() - now.getTime();
  if (left <= 0) {
    const ago = minutes(-left);
    return {
      minutesLeft: 0,
      level: "over",
      reason: "over",
      rule,
      message: `The permit ended ${ago <= 1 ? "just now" : `${plural(ago)} ago`}. ${rule}`,
    };
  }
  const minutesLeft = minutes(left);
  const limitEnd =
    input.timeLimitMinutes === null
      ? null
      : input.startsAt.getTime() + input.timeLimitMinutes * 60_000;
  const elapsed = now.getTime() - input.startsAt.getTime();
  const halvesLeft =
    input.innings === null
      ? null
      : Math.max(0, input.innings * 2 - input.halvesEntered);
  const pace =
    input.halvesEntered >= MIN_HALVES_FOR_PACE && elapsed > 0
      ? elapsed / input.halvesEntered
      : null;
  const paceEnd =
    pace !== null && halvesLeft !== null && halvesLeft > 0
      ? now.getTime() + halvesLeft * pace
      : null;
  const base = { minutesLeft, rule };
  if (limitEnd !== null && limitEnd > permitEndsAt.getTime())
    return {
      ...base,
      level: "watch",
      reason: "time_limit",
      message: `The time limit would run past the permit, which ends in ${plural(minutesLeft)}. ${rule}`,
    };
  if (paceEnd !== null && paceEnd > permitEndsAt.getTime())
    return {
      ...base,
      level: "watch",
      reason: "pace",
      message: `At this pace the game runs past the permit, which ends in ${plural(minutesLeft)}. ${rule}`,
    };
  return {
    ...base,
    level: "ok",
    reason: null,
    message: `${plural(minutesLeft)} left in the permit.`,
  };
}
