import type { Point } from "../capacity/nearby";
import { NEW_YORK, sunset } from "../permits/sun";
import { dateTimeFormat } from "../time/format-cache";

/**
 * The daylight and field-time clock (issue #467). Games start late, run out
 * of light or into the time the field must be clear, and get cut short with
 * arguments about the score. This works out, without any paid service, when
 * play must end, counts down to first pitch and to that end, and tells
 * whether a start was late. Pure: the caller passes the clock.
 */

/** Why play must end when it does. */
export type EndReason = "daylight" | "field_time";

export const END_REASON_LABEL: Record<EndReason, string> = {
  daylight: "daylight",
  field_time: "field time",
};

/** Minutes before sunset that play ends on a field without lights. */
export const DEFAULT_DAYLIGHT_MARGIN_MINUTES = 15;
export const MAX_DAYLIGHT_MARGIN_MINUTES = 60;

/** A start this many minutes after the slot's time still counts as on time. */
export const LATE_GRACE_MINUTES = 5;

/**
 * The margin a rule set's options pick, or the default. A value outside 0 to
 * 60 minutes, or not a whole number, falls back to the default.
 */
export function daylightMargin(
  options: { daylightMarginMinutes?: unknown } | null | undefined,
): number {
  const value = options?.daylightMarginMinutes;
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_DAYLIGHT_MARGIN_MINUTES
    ? value
    : DEFAULT_DAYLIGHT_MARGIN_MINUTES;
}

/**
 * Sunset on the game's own day in the league's time zone, at the park, or at
 * City Hall when the park has no coordinates. The day is the local one, so a
 * 7 pm game in New York, which is past midnight in UTC, still gets its own
 * evening's sunset.
 */
export function sunsetFor(
  startsAt: Date,
  timeZone: string,
  at: Point | null,
): Date | null {
  return sunset(localDate(startsAt, timeZone), at ?? NEW_YORK);
}

/** The calendar day of an instant in a time zone, YYYY-MM-DD. */
const localDate = (instant: Date, timeZone: string) =>
  dateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(instant);

export type EndOfPlay = { endsAt: Date; reason: EndReason };

/**
 * When play must end: the earlier of the time the field must be clear and
 * sunset less the margin. A field with lights has no daylight end. When
 * both fall at the same minute, the field time is named, as the firmer
 * rule. Null when neither is known.
 */
export function endOfPlay(input: {
  /** The end of the league's hold on the field; null with no permit. */
  clearBy: Date | null;
  sunsetAt: Date | null;
  hasLights: boolean;
  marginMinutes: number;
}): EndOfPlay | null {
  const dark =
    input.hasLights || !input.sunsetAt
      ? null
      : new Date(input.sunsetAt.getTime() - input.marginMinutes * 60_000);
  const { clearBy } = input;
  if (clearBy && (!dark || clearBy.getTime() <= dark.getTime()))
    return { endsAt: clearBy, reason: "field_time" };
  if (dark) return { endsAt: dark, reason: "daylight" };
  return null;
}

/** Whole minutes from `from` to `to`, rounded toward zero. */
export const minutesBetween = (from: Date, to: Date) =>
  Math.trunc((to.getTime() - from.getTime()) / 60_000);

/**
 * Minutes a start came after the slot's time, or 0 for one on time or
 * early.
 */
export function minutesLate(firstPitchAt: Date, startedAt: Date): number {
  return Math.max(0, minutesBetween(firstPitchAt, startedAt));
}

/** Late enough to count against the team that held it up. */
export const isLateStart = (firstPitchAt: Date, startedAt: Date) =>
  minutesLate(firstPitchAt, startedAt) > LATE_GRACE_MINUTES;

export type Countdown =
  /** No first pitch yet, and it is not due. */
  | { phase: "before"; minutesToFirstPitch: number; minutesOfPlay: number }
  /** No first pitch yet, and it was due. */
  | { phase: "late"; minutesLate: number; minutesOfPlay: number }
  /** Started; play must end in `minutesLeft`. */
  | { phase: "playing"; minutesLeft: number }
  /** Play should have ended. */
  | { phase: "over"; minutesOver: number };

/**
 * Where a game stands against its first pitch and its end of play. The
 * minutes of play are what is left between the later of now and the first
 * pitch, and the end: every minute late comes off the game.
 */
export function countdown(input: {
  firstPitchAt: Date;
  startedAt: Date | null;
  endsAt: Date;
  now: Date;
}): Countdown {
  const { firstPitchAt, startedAt, endsAt, now } = input;
  const ms = (d: Date) => d.getTime();
  if (ms(now) >= ms(endsAt))
    return { phase: "over", minutesOver: minutesBetween(endsAt, now) };
  if (startedAt)
    return {
      phase: "playing",
      minutesLeft: Math.ceil((ms(endsAt) - ms(now)) / 60_000),
    };
  const from = ms(now) > ms(firstPitchAt) ? now : firstPitchAt;
  const minutesOfPlay = Math.max(0, minutesBetween(from, endsAt));
  if (ms(now) > ms(firstPitchAt))
    return {
      phase: "late",
      minutesLate: minutesBetween(firstPitchAt, now),
      minutesOfPlay,
    };
  return {
    phase: "before",
    minutesToFirstPitch: Math.ceil((ms(firstPitchAt) - ms(now)) / 60_000),
    minutesOfPlay,
  };
}

const plural = (n: number, word = "minute") =>
  `${n} ${word}${n === 1 ? "" : "s"}`;

/** One sentence for the ref's and captains' screens. */
export function countdownMessage(c: Countdown, end: EndOfPlay): string {
  const why =
    end.reason === "daylight"
      ? "before dark"
      : "before the field must be clear";
  switch (c.phase) {
    case "before":
      return `First pitch in ${plural(c.minutesToFirstPitch)}. That leaves ${plural(c.minutesOfPlay)} of play ${why}.`;
    case "late":
      return `First pitch was due ${c.minutesLate <= 0 ? "just now" : `${plural(c.minutesLate)} ago`}. Every minute late comes off the game: ${plural(c.minutesOfPlay)} of play left ${why}.`;
    case "playing":
      return `${plural(c.minutesLeft)} of play left ${why}.`;
    case "over":
      return end.reason === "daylight"
        ? "Time is up: play had to end to finish before dark."
        : "Time is up: the field must be clear.";
  }
}

/**
 * A slot that runs past the end of daylight on a field without lights, for
 * the scheduler's warning. Null when the slot is fine. In summer the light
 * lasts past the latest slot; in spring and fall a late slot runs into the
 * dark, which is when this warns.
 */
export function slotPastDaylight(input: {
  slotStartsAt: Date;
  slotEndsAt: Date;
  timeZone: string;
  at: Point | null;
  hasLights: boolean;
  marginMinutes: number;
}): { minutesShort: number; sunsetAt: Date } | null {
  if (input.hasLights) return null;
  const sunsetAt = sunsetFor(input.slotStartsAt, input.timeZone, input.at);
  if (!sunsetAt) return null;
  const dark = sunsetAt.getTime() - input.marginMinutes * 60_000;
  const short = Math.ceil((input.slotEndsAt.getTime() - dark) / 60_000);
  return short > 0 ? { minutesShort: short, sunsetAt } : null;
}

/** A late start costs innings when play must end this soon after the slot does. */
export const TIGHT_MINUTES = 15;

/**
 * Whether a game has no time to spare: play must end no later than a
 * quarter of an hour after its slot does, so a late start comes out of the
 * game itself. These games get the start-on-time nudge.
 */
export const isTight = (slotEndsAt: Date, endsAt: Date) =>
  endsAt.getTime() <= slotEndsAt.getTime() + TIGHT_MINUTES * 60_000;

export const HELD_UP_BY = ["team_a", "team_b", "both", "neither"] as const;
export type HeldUpBy = (typeof HELD_UP_BY)[number];

export type StartRecord = {
  teamAId: string;
  teamBId: string;
  firstPitchAt: Date;
  startedAt: Date;
  heldUpBy: HeldUpBy | null;
};

export type Punctuality = {
  teamSeasonId: string;
  /** Games of the team with a recorded start. */
  starts: number;
  /** Late starts this team was named for holding up. */
  lateStarts: number;
  /** Minutes lost to those late starts, together. */
  minutesLost: number;
};

/** Whether a record names the team for holding up the start. */
function heldUp(r: StartRecord, team: string): boolean {
  if (r.heldUpBy === "both") return r.teamAId === team || r.teamBId === team;
  if (r.heldUpBy === "team_a") return r.teamAId === team;
  if (r.heldUpBy === "team_b") return r.teamBId === team;
  return false;
}

/**
 * The admins' punctuality summary: per team, its recorded starts, the late
 * ones it held up, and the minutes those cost. A late start nobody was named
 * for, or one held up by neither team (the ref, the field), counts against
 * no team. Sorted with the most late starts first, then most minutes.
 */
export function punctuality(records: readonly StartRecord[]): Punctuality[] {
  const byTeam = new Map<string, Punctuality>();
  const entry = (team: string) => {
    const known = byTeam.get(team);
    if (known) return known;
    const fresh = {
      teamSeasonId: team,
      starts: 0,
      lateStarts: 0,
      minutesLost: 0,
    };
    byTeam.set(team, fresh);
    return fresh;
  };
  for (const r of records) {
    const late = isLateStart(r.firstPitchAt, r.startedAt);
    for (const team of [r.teamAId, r.teamBId]) {
      const e = entry(team);
      e.starts += 1;
      if (late && heldUp(r, team)) {
        e.lateStarts += 1;
        e.minutesLost += minutesLate(r.firstPitchAt, r.startedAt);
      }
    }
  }
  return [...byTeam.values()].sort(
    (a, b) =>
      b.lateStarts - a.lateStarts ||
      b.minutesLost - a.minutesLost ||
      a.teamSeasonId.localeCompare(b.teamSeasonId),
  );
}
