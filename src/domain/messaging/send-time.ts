import { err, ok, type Result } from "../result";

/**
 * When a scheduled announcement goes out (ADR 0052). Scheduled jobs run once
 * a day on the free hosting plan, so a scheduled announcement leaves with
 * the outbox's daily sweep (vercel.json, `/api/jobs/outbox`) on the day the
 * admin picks. Any earlier drain, such as the one after another message is
 * sent, can't release it before that time, so the sweep is the send time.
 * Pure: the caller passes the clock.
 */

/** The outbox sweep's time of day, in UTC; vercel.json's schedule matches. */
export const OUTBOX_SWEEP_UTC = { hour: 13, minute: 30 } as const;

/** How far ahead an announcement may be scheduled. */
export const MAX_DAYS_AHEAD = 120;

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The sweep on a calendar day (YYYY-MM-DD). For a league west of UTC, or
 * up to ten hours east, that's the same date in the league's time zone:
 * 8:30 or 9:30 a.m. in New York.
 */
export function sweepOn(day: string): Date {
  return new Date(
    `${day}T${pad(OUTBOX_SWEEP_UTC.hour)}:${pad(OUTBOX_SWEEP_UTC.minute)}:00Z`,
  );
}

/** The first sweep after `now`. */
export function nextSweep(now: Date): Date {
  const today = sweepOn(now.toISOString().slice(0, 10));
  return today > now ? today : new Date(today.getTime() + DAY_MS);
}

export type SendChoice = "now" | "next" | "day";
export type SendTimeError =
  "bad_send_time" | "send_day_passed" | "send_day_far";

/**
 * Reads the form's choice: null to send now, or the sweep to send with.
 * A day must still have its sweep ahead, and be within MAX_DAYS_AHEAD.
 */
export function parseSendAt(
  fields: { when?: unknown; day?: unknown },
  now: Date,
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
  const at = sweepOn(fields.day);
  if (
    Number.isNaN(at.getTime()) ||
    at.toISOString().slice(0, 10) !== fields.day
  )
    return err("bad_send_time");
  if (at <= now) return err("send_day_passed");
  if (at.getTime() - now.getTime() > MAX_DAYS_AHEAD * DAY_MS)
    return err("send_day_far");
  return ok(at);
}
