import { localDate } from "../books/ledger-csv";
import { localTime } from "../time/zoned";
import {
  nextYear,
  periodDates,
  type PeriodDates,
  periodOf,
  type Span,
  within,
} from "./calendar";

/**
 * Renewing a season's NYC Parks permits (ADR 0056). A returning league that
 * asks for the same fields and hours as last year, during the renewal
 * period, gets preference for them; different hours or more fields make
 * the change a new request (Rule 2-12, (a) and (b)(7)). So the draft renews
 * exactly what the season held, and anything the owners add is split off
 * as a separate new request instead of being folded into the renewal.
 */

/** Minutes past midnight of a local HH:MM. */
const minutes = (hhmm: string) =>
  Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

const clock = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

const DAY_MS = 86_400_000;

const weekdayOf = (on: string) => new Date(`${on}T12:00:00Z`).getUTCDay();

const addDays = (on: string, days: number) =>
  new Date(Date.parse(`${on}T12:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);

/** A field held at the same hours on the same weekday all season. */
export type Pattern = {
  /** `fieldId/weekday/start/end`, stable while the permits don't change. */
  key: string;
  fieldId: string;
  /** Such as "McCarren Park, Field 2". */
  place: string;
  /** 0 Sunday to 6 Saturday. */
  weekday: number;
  /** Local HH:MM. */
  start: string;
  end: string;
  /** The season's dates it was held, YYYY-MM-DD, in order. */
  dates: string[];
};

/** The season's held windows (not the lost ones) as weekly patterns. */
export function patternsOf(
  windows: readonly {
    fieldId: string;
    place: string;
    startsAt: Date;
    endsAt: Date;
  }[],
  timeZone: string,
): Pattern[] {
  const byKey = new Map<string, Pattern>();
  for (const w of windows) {
    const on = localDate(w.startsAt, timeZone);
    const start = localTime(w.startsAt, timeZone);
    const end = localTime(w.endsAt, timeZone);
    // A window past midnight isn't a pattern the application can ask for.
    if (end <= start) continue;
    const weekday = weekdayOf(on);
    const key = `${w.fieldId}/${weekday}/${start}/${end}`;
    const found = byKey.get(key);
    if (found) found.dates.push(on);
    else
      byKey.set(key, {
        key,
        fieldId: w.fieldId,
        place: w.place,
        weekday,
        start,
        end,
        dates: [on],
      });
  }
  return [...byKey.values()]
    .map((p) => ({ ...p, dates: [...new Set(p.dates)].sort() }))
    .sort(
      (a, b) =>
        a.weekday - b.weekday ||
        a.place.localeCompare(b.place) ||
        a.start.localeCompare(b.start),
    );
}

/** The NYC Parks period the season's permits renew into, a year on. */
export function renewalTarget(
  patterns: readonly Pattern[],
): PeriodDates | null {
  const first = patterns.flatMap((p) => p.dates).sort()[0];
  return first ? nextYear(periodOf(first)) : null;
}

/**
 * Last season's dates a year on: 52 weeks later, so each lands on the same
 * weekday. That is a day or two earlier in the year, so a date that would
 * fall just before the target period moves a week later, and one just past
 * it a week earlier. Dates still outside the period are left out, and
 * counted by the caller.
 */
export function draftDates(
  dates: readonly string[],
  target: PeriodDates,
): string[] {
  const before = periodDates(target.period, target.year - 1).plays;
  const moved = dates.flatMap((d) => {
    // Dates outside last year's period stay outside this year's.
    if (!within(d, before)) return [];
    const on = addDays(d, 364);
    if (on < target.plays.from) return [addDays(on, 7)];
    if (on > target.plays.to) return [addDays(on, -7)];
    return [on];
  });
  return [...new Set(moved.filter((d) => within(d, target.plays)))].sort();
}

/**
 * What the league held: the confirmed windows, or the requested ones when
 * the owners never marked any confirmed. Lost windows are never renewed.
 */
export function heldWindows<T extends { status: string }>(
  windows: readonly T[],
): T[] {
  const confirmed = windows.filter((w) => w.status === "confirmed");
  return confirmed.length > 0
    ? confirmed
    : windows.filter((w) => w.status === "requested");
}

/** What the owners want for next year, from the renewal screen. */
export type Wanted = {
  /** The pattern this changes; none for a field or day added. */
  of: string | null;
  fieldId: string;
  place: string;
  weekday: number;
  start: string;
  end: string;
};

export type Row = { date: string; place: string; start: string; end: string };

export type RenewalWarning =
  | { kind: "more_time"; place: string; weekday: number; extra: string[] }
  | { kind: "changed_hours"; place: string; weekday: number; held: string }
  | { kind: "dropped"; place: string; weekday: number; held: string }
  | { kind: "new_field"; place: string; weekday: number }
  | { kind: "weekly_cap"; hours: number }
  /** Dates of a pattern that fall outside the next period, left out. */
  | { kind: "outside_period"; place: string; weekday: number; dates: number };

export type RenewalPlan = {
  target: PeriodDates;
  renewal: Row[];
  /** Asked for separately, as a new request in the new-request period. */
  extra: Row[];
  warnings: RenewalWarning[];
  renewalHours: number;
  extraHours: number;
};

/** One holder may renew at most 50 hours a week (Rule 2-12, (c)(10)). */
export const WEEKLY_RENEWAL_CAP = 50;

const rowsOf = (
  dates: readonly string[],
  place: string,
  start: number,
  end: number,
): Row[] =>
  dates.map((date) => ({ date, place, start: clock(start), end: clock(end) }));

const hoursOf = (rows: readonly Row[]) =>
  rows.reduce((t, r) => t + (minutes(r.end) - minutes(r.start)), 0) / 60;

/**
 * The renewal and any new request: every held pattern is renewed with its
 * own hours; time the owners want beyond it (earlier, later, another field
 * or another day) becomes the new request; a pattern they drop or shorten
 * is flagged, since renewing less loses it for good. Wanted rows that fall
 * inside what is held add nothing.
 */
export function splitRenewal(
  held: readonly Pattern[],
  wanted: readonly Wanted[],
  target: PeriodDates,
): RenewalPlan {
  const renewal: Row[] = [];
  const extra: Row[] = [];
  const warnings: RenewalWarning[] = [];
  const allDraft: string[] = [];
  const weekly = new Map<string, number>();

  for (const p of held) {
    const dates = draftDates(p.dates, target);
    allDraft.push(...dates);
    if (dates.length < p.dates.length)
      warnings.push({
        kind: "outside_period",
        place: p.place,
        weekday: p.weekday,
        dates: p.dates.length - dates.length,
      });
    const s = minutes(p.start);
    const e = minutes(p.end);
    const asked = wanted.filter((w) => w.of === p.key);
    const heldText = `${p.start}–${p.end}`;
    if (asked.length === 0) {
      warnings.push({
        kind: "dropped",
        place: p.place,
        weekday: p.weekday,
        held: heldText,
      });
      continue;
    }
    renewal.push(...rowsOf(dates, p.place, s, e));
    weekly.set(p.key, (e - s) / 60);
    for (const w of asked) {
      const ws = minutes(w.start);
      const we = minutes(w.end);
      if (we <= ws) continue;
      if (ws > s || we < e)
        warnings.push({
          kind: "changed_hours",
          place: p.place,
          weekday: p.weekday,
          held: heldText,
        });
      const pieces: [number, number][] = [];
      if (ws < s) pieces.push([ws, Math.min(we, s)]);
      if (we > e) pieces.push([Math.max(ws, e), we]);
      for (const [a, b] of pieces) extra.push(...rowsOf(dates, p.place, a, b));
      if (pieces.length > 0)
        warnings.push({
          kind: "more_time",
          place: p.place,
          weekday: p.weekday,
          extra: pieces.map(([a, b]) => `${clock(a)}–${clock(b)}`),
        });
    }
  }

  // A new field or day runs over the same weeks as the renewal.
  const sorted = allDraft.sort();
  const span: Span = {
    from: sorted[0] ?? target.plays.from,
    to: sorted.at(-1) ?? target.plays.to,
  };
  for (const w of wanted) {
    if (w.of !== null) continue;
    const ws = minutes(w.start);
    const we = minutes(w.end);
    if (we <= ws || w.weekday < 0 || w.weekday > 6) continue;
    const first = addDays(
      span.from,
      (w.weekday - weekdayOf(span.from) + 7) % 7,
    );
    const dates: string[] = [];
    for (let d = first; d <= span.to; d = addDays(d, 7)) dates.push(d);
    extra.push(...rowsOf(dates, w.place, ws, we));
    warnings.push({ kind: "new_field", place: w.place, weekday: w.weekday });
  }

  const perWeek = [...weekly.values()].reduce((a, b) => a + b, 0);
  if (perWeek > WEEKLY_RENEWAL_CAP)
    warnings.push({ kind: "weekly_cap", hours: perWeek });

  const byDate = (a: Row, b: Row) =>
    a.date.localeCompare(b.date) ||
    a.place.localeCompare(b.place) ||
    a.start.localeCompare(b.start);
  renewal.sort(byDate);
  extra.sort(byDate);
  return {
    target,
    renewal,
    extra,
    warnings,
    renewalHours: hoursOf(renewal),
    extraHours: hoursOf(extra),
  };
}
