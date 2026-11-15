import { err, ok, type Result } from "../result";
import { zonedInstant } from "../time/zoned";

/**
 * Other groups that use a field before or after the league (issue #408):
 * what an admin may record about one, the next handover the game-day crew
 * watches, and the warnings about days two groups hold the same time.
 * Pure: queries hand over rows, and the screens and the command center read
 * the answers. Every time is a wall clock in the league's time zone, turned
 * into instants day by day so midnight and daylight saving behave.
 */

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const MAX_NAME = 80;
export const MAX_CONTACT = 200;
export const MAX_NOTE = 300;

/** The countdown shows in the last half hour before a handover. */
export const COUNTDOWN_MINUTES = 30;

export type GroupInput = {
  name: string;
  /** 0 (Sunday) to 6. */
  weekdays: number[];
  /** HH:MM, local; null with no weekdays. */
  startsAt: string | null;
  endsAt: string | null;
  contact: string | null;
};

export type GroupError =
  "name" | "weekdays" | "hours" | "hours_same" | "contact";

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "20:00:00" or "20:00" → "20:00". */
export const clockOf = (time: string | null): string | null =>
  time === null ? null : time.slice(0, 5);

/**
 * A group from raw form text. A group with no usual hours is fine (name
 * only); days without hours, hours without days, or an end equal to the
 * start are not. An end before the start means the hours run past midnight.
 */
export function parseGroup(raw: {
  name: string;
  weekdays: readonly string[];
  startsAt: string;
  endsAt: string;
  contact: string;
}): Result<GroupInput, GroupError> {
  const name = raw.name.trim().replace(/\s+/g, " ");
  if (name === "" || name.length > MAX_NAME) return err("name");
  const days = new Set<number>();
  for (const d of raw.weekdays) {
    if (!/^[0-6]$/.test(d)) return err("weekdays");
    days.add(Number(d));
  }
  const startsAt = raw.startsAt.trim();
  const endsAt = raw.endsAt.trim();
  const contact = raw.contact.trim();
  if (contact.length > MAX_CONTACT) return err("contact");
  const hours = startsAt !== "" || endsAt !== "";
  if (days.size === 0 && !hours)
    return ok({
      name,
      weekdays: [],
      startsAt: null,
      endsAt: null,
      contact: contact || null,
    });
  if (days.size === 0) return err("weekdays");
  if (!CLOCK.test(startsAt) || !CLOCK.test(endsAt)) return err("hours");
  if (startsAt === endsAt) return err("hours_same");
  return ok({
    name,
    weekdays: [...days].sort((a, b) => a - b),
    startsAt,
    endsAt,
    contact: contact || null,
  });
}

export type Usual = {
  weekdays: readonly number[];
  startsAt: string | null;
  endsAt: string | null;
};

const addDay = (date: string, days: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

/** 0 (Sunday) to 6 for a YYYY-MM-DD date. */
export const weekdayOf = (date: string) =>
  new Date(`${date}T12:00:00Z`).getUTCDay();

export type Span = { start: Date; end: Date };

/**
 * When a group is usually on the field around a local date: the hours that
 * start that day, and the tail of the night before that ran past midnight.
 * Empty for a group with no usual hours.
 */
export function usualSpans(
  usual: Usual,
  date: string,
  timeZone: string,
): Span[] {
  const s = clockOf(usual.startsAt);
  const e = clockOf(usual.endsAt);
  if (!s || !e || usual.weekdays.length === 0) return [];
  const dayStart = zonedInstant(date, "00:00", timeZone);
  const dayEnd = zonedInstant(addDay(date, 1), "00:00", timeZone);
  const spans: Span[] = [];
  for (const day of [addDay(date, -1), date]) {
    if (!usual.weekdays.includes(weekdayOf(day))) continue;
    const start = zonedInstant(day, s, timeZone);
    const end = zonedInstant(e > s ? day : addDay(day, 1), e, timeZone);
    // Only what touches the local day matters to its game day.
    if (end > dayStart && start < dayEnd) spans.push({ start, end });
  }
  return spans;
}

export type FieldGroup = Usual & {
  id: string;
  fieldId: string;
  name: string;
};

export type HandoverKind = "after" | "before" | "overlap";

export type Handover = {
  groupId: string;
  group: string;
  kind: HandoverKind;
  /** When the field changes hands for the league's crew. */
  at: Date;
  /** The group's usual start (after, overlap) or end (before). */
  usual: Date;
};

/**
 * The handovers at one field on a game day, soonest first: the league's hold
 * on the field (`ours`) against each other group's usual hours. A group on
 * after us takes the field when our hold ends; one on before hands it to us
 * when our hold starts; one whose usual hours cut into ours is an overlap,
 * flagged at the time it starts. Handovers already past are left out.
 */
export function nextHandovers(input: {
  groups: readonly FieldGroup[];
  ours: Span;
  date: string;
  timeZone: string;
  now: Date;
}): Handover[] {
  const out: Handover[] = [];
  for (const g of input.groups) {
    for (const span of usualSpans(g, input.date, input.timeZone)) {
      const base = { groupId: g.id, group: g.name };
      const h: Handover =
        span.end <= input.ours.start
          ? { ...base, kind: "before", at: input.ours.start, usual: span.end }
          : span.start >= input.ours.end
            ? { ...base, kind: "after", at: input.ours.end, usual: span.start }
            : {
                ...base,
                kind: "overlap",
                at:
                  span.start > input.ours.start ? span.start : input.ours.start,
                usual: span.start,
              };
      if (h.at.getTime() >= input.now.getTime()) out.push(h);
    }
  }
  return out.sort(
    (a, b) => a.at.getTime() - b.at.getTime() || a.group.localeCompare(b.group),
  );
}

/**
 * Whole minutes left before `at`, rounded up, when it is within the
 * countdown window; null earlier, and null once it has come.
 */
export function countdown(at: Date, now: Date): number | null {
  const ms = at.getTime() - now.getTime();
  if (ms <= 0) return null;
  const minutes = Math.ceil(ms / 60_000);
  return minutes <= COUNTDOWN_MINUTES ? minutes : null;
}

export type RecordedOverlap = {
  id: string;
  groupId: string;
  group: string;
  fieldId: string;
  /** YYYY-MM-DD. */
  on: string;
  note: string | null;
};

export type OverlapWarning = RecordedOverlap & {
  /** False when the league isn't using the field that day: rained out, blacked out or no permit. */
  stillNeeded: boolean;
  reason: "rained_out" | "blackout" | "no_permit" | null;
};

/**
 * The recorded overlaps from `today` on, soonest first. One the league no
 * longer needs sorting out (its games that day were rained out or blacked
 * out, or it holds no permit there any more) stays listed but marked, so
 * nobody phones the permit office for a day that isn't happening.
 */
export function overlapWarnings(input: {
  overlaps: readonly RecordedOverlap[];
  today: string;
  /** `date/fieldId` for each day a field has a permit the league still holds. */
  held: ReadonlySet<string>;
  /** `date/fieldId` where every slot is cancelled. */
  rainedOut: ReadonlySet<string>;
  /** `date` for all fields, `date/fieldId` for one. */
  blackouts: ReadonlySet<string>;
}): OverlapWarning[] {
  return input.overlaps
    .filter((o) => o.on >= input.today)
    .map((o): OverlapWarning => {
      const key = `${o.on}/${o.fieldId}`;
      const reason =
        input.blackouts.has(o.on) || input.blackouts.has(key)
          ? "blackout"
          : input.rainedOut.has(key)
            ? "rained_out"
            : !input.held.has(key)
              ? "no_permit"
              : null;
      return { ...o, stillNeeded: reason === null, reason };
    })
    .sort((a, b) => a.on.localeCompare(b.on) || a.group.localeCompare(b.group));
}
