import { err, ok, type Result } from "../result";
import { localDay } from "../schedule/public-game";
import { addDays } from "../season/rollover";

/**
 * When a scheduled announcement goes out (ADR 0058). Scheduled jobs run once
 * a day on the free hosting plan, so a scheduled announcement leaves with
 * the outbox's daily sweep (vercel.json, `/api/jobs/outbox`) on the day the
 * admin picks. Any earlier drain, such as the one after another message is
 * sent, can't release it before that time, so the sweep is the send time.
 * Pure: the caller passes the clock and the league's time zone.
 */

/** The outbox sweep's time of day, in UTC; vercel.json's schedule matches. */
export const OUTBOX_SWEEP_UTC = { hour: 13, minute: 30 } as const;

/** How far ahead an announcement may be scheduled. */
export const MAX_DAYS_AHEAD = 120;

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

const utcSweep = (day: string) =>
  new Date(
    `${day}T${pad(OUTBOX_SWEEP_UTC.hour)}:${pad(OUTBOX_SWEEP_UTC.minute)}:00Z`,
  );

/**
 * The sweep that falls on a calendar day (YYYY-MM-DD) in the league's time
 * zone. The sweep runs at a fixed UTC time, so in New York it is 9:30 a.m.
 * in summer and 8:30 a.m. in winter, the same date either way. Far east of
 * UTC (New Zealand, say) the sweep on the UTC date before is the one that
 * lands on the chosen local day.
 *
 * A day shortened by the clocks going forward can have no sweep at all:
 * in Sydney, 3 October 2027 runs from 14:00 UTC the day before to 13:00
 * UTC, so the sweeps fall at 23:30 on the 2nd and 00:30 on the 4th. Then
 * it is the first sweep after the day, never one before it: a message
 * scheduled for a day never goes out early.
 */
export function sweepOn(day: string, timeZone: string): Date {
  // Candidates in time order; local days only ever increase with time, so
  // the first not before `day` is that day's sweep, or the next one.
  for (const d of [addDays(day, -1), day, addDays(day, 1)]) {
    const at = utcSweep(d);
    if (localDay(at, timeZone) >= day) return at;
  }
  return utcSweep(addDays(day, 1));
}

/** The first sweep after `now`. */
export function nextSweep(now: Date): Date {
  const today = utcSweep(now.toISOString().slice(0, 10));
  return today > now ? today : new Date(today.getTime() + DAY_MS);
}

export type SendChoice = "now" | "next" | "day";
export type SendTimeError =
  "bad_send_time" | "send_day_passed" | "send_day_far";

/**
 * Reads the form's choice: null to send now, or the sweep to send with.
 * A day is the league's local date. It must still have its sweep ahead,
 * and be within MAX_DAYS_AHEAD.
 */
export function parseSendAt(
  fields: { when?: unknown; day?: unknown },
  now: Date,
  timeZone: string,
): Result<Date | null, SendTimeError> {
  if (
    fields.when === undefined ||
    fields.when === null ||
    fields.when === "now"
  )
    return ok(null);
  if (fields.when === "next") return ok(nextSweep(now));
  if (fields.when !== "day" || typeof fields.day !== "string")
    return err("bad_send_time");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.day)) return err("bad_send_time");
  const check = utcSweep(fields.day);
  if (
    Number.isNaN(check.getTime()) ||
    check.toISOString().slice(0, 10) !== fields.day
  )
    return err("bad_send_time");
  const at = sweepOn(fields.day, timeZone);
  if (at <= now) return err("send_day_passed");
  if (at.getTime() - now.getTime() > MAX_DAYS_AHEAD * DAY_MS)
    return err("send_day_far");
  return ok(at);
}
