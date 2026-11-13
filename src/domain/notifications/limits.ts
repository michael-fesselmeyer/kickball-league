import { z } from "zod";
import type { DeliveryClass } from "./kinds";

/**
 * How many non-urgent messages a person takes a day, when the ones over
 * that come as a digest, and when their phone stays quiet. All local times
 * are in the league's time zone. See docs/architecture.md, section 5.
 */
export type AlertLimits = {
  /** Non-urgent messages a day on each channel; 0 means digest only. */
  dailyCap: number;
  digest: DigestFrequency;
  /** Whole local hours; null when the person turned quiet hours off. */
  quietHours: QuietHours | null;
};

export type QuietHours = { startHour: number; endHour: number };

export const DIGEST_FREQUENCIES = ["daily", "weekly"] as const;
export type DigestFrequency = (typeof DIGEST_FREQUENCIES)[number];

/** The most a person can take; they can lower it, not raise it. */
export const MAX_DAILY_CAP = 3;

/** 10 pm to 8 am. */
export const DEFAULT_QUIET_HOURS: QuietHours = { startHour: 22, endHour: 8 };

export const DEFAULT_LIMITS: AlertLimits = {
  dailyCap: MAX_DAILY_CAP,
  digest: "daily",
  quietHours: DEFAULT_QUIET_HOURS,
};

/** The digest goes out at 6 pm, on Sundays when it is weekly. */
export const DIGEST_HOUR = 18;
export const DIGEST_WEEKDAY = 0;

const hour = z.coerce.number().int().min(0).max(23);

/** The fields of the settings form. */
export const ALERT_LIMIT_FIELDS = [
  "dailyCap",
  "digest",
  "quiet",
  "quietStart",
  "quietEnd",
] as const;

/** The settings form, as the profile page posts it. */
export const alertLimitsForm = z
  .object({
    dailyCap: z.coerce.number().int().min(0).max(MAX_DAILY_CAP),
    digest: z.enum(DIGEST_FREQUENCIES),
    /** The checkbox: "on" when ticked, "" or missing when not. */
    quiet: z
      .string()
      .optional()
      .transform((v) => v === "on"),
    quietStart: hour,
    quietEnd: hour,
  })
  .refine((f) => !f.quiet || f.quietStart !== f.quietEnd, {
    error: "Quiet hours must start and end at different times",
    path: ["quietEnd"],
  })
  .transform((f): AlertLimits => ({
    dailyCap: f.dailyCap,
    digest: f.digest,
    quietHours: f.quiet
      ? { startHour: f.quietStart, endHour: f.quietEnd }
      : null,
  }));

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** One formatter per zone: the outbox asks the local clock for every message. */
const clocks = new Map<string, Intl.DateTimeFormat>();

/** The local date (YYYY-MM-DD) and minute of the day at an instant. */
export function wallClock(
  instant: Date,
  timeZone: string,
): { date: string; minutes: number } {
  let clock = clocks.get(timeZone);
  if (!clock) {
    clock = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    clocks.set(timeZone, clock);
  }
  const parts = clock.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "0";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

const minutesOfDay = (instant: Date, timeZone: string) =>
  wallClock(instant, timeZone).minutes;

const localDate = (instant: Date, timeZone: string) =>
  wallClock(instant, timeZone).date;

/** Minutes the zone is ahead of UTC at instant `t` (ms), from the cached clock. */
const offsetAt = (t: number, timeZone: string) => {
  const wall = wallClock(new Date(t), timeZone);
  const wallMs = Date.parse(`${wall.date}T00:00:00Z`) + wall.minutes * MINUTE;
  return Math.round((wallMs - Math.floor(t / MINUTE) * MINUTE) / MINUTE);
};

/**
 * The instant the clock reads `hh:00` on `date`, as zonedInstant in
 * src/domain/time/zoned.ts finds it, but with the cached clock: the outbox
 * and its property tests ask this thousands of times.
 */
function wallInstant(date: string, hh: number, timeZone: string): Date {
  const wall = Date.parse(`${date}T${pad(hh)}:00:00Z`);
  const before = offsetAt(wall, timeZone);
  const first = wall - before * MINUTE;
  const after = offsetAt(first, timeZone);
  if (after === before) return new Date(first);
  const second = wall - after * MINUTE;
  if (offsetAt(second, timeZone) === after) return new Date(second);
  // The clock skipped this time: take the later reading.
  return new Date(Math.max(first, second));
}

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The first instant whose wall clock in `timeZone` reads `date` at or after
 * `hh:00`. Unlike a plain conversion, a time a fall-back change repeats
 * resolves to its first reading, and one a spring-forward change skips to
 * the moment the clock jumps past it.
 */
export function startOfLocalHour(
  date: string,
  hh: number,
  timeZone: string,
): Date {
  const at = wallInstant(date, hh, timeZone);
  // A repeated hour has an earlier reading, a clock change (30 minutes to
  // 2 hours, depending on the zone) before the one wallInstant picked.
  const earlier = [120, 60, 30]
    .map((minutes) => new Date(at.getTime() - minutes * MINUTE))
    .find((t) => {
      const local = wallClock(t, timeZone);
      return local.date === date && local.minutes >= hh * 60;
    });
  return earlier ?? at;
}

/** The first instant of the local day `instant` falls on. */
export const startOfLocalDay = (instant: Date, timeZone: string): Date =>
  startOfLocalHour(localDate(instant, timeZone), 0, timeZone);

/** Whether the local clock at `instant` is inside the quiet hours. */
export function inQuietHours(
  instant: Date,
  timeZone: string,
  quiet: QuietHours | null,
): boolean {
  if (!quiet || quiet.startHour === quiet.endHour) return false;
  const m = minutesOfDay(instant, timeZone);
  const start = quiet.startHour * 60;
  const end = quiet.endHour * 60;
  return start < end ? m >= start && m < end : m >= start || m < end;
}

/**
 * When quiet hours that cover `now` are over: the first instant after it
 * that is not quiet. `now` itself when it is not quiet.
 */
export function quietHoursEnd(
  now: Date,
  timeZone: string,
  quiet: QuietHours | null,
): Date {
  if (!quiet || !inQuietHours(now, timeZone, quiet)) return now;
  const today = localDate(now, timeZone);
  const found = [0, 1, 2]
    .map((d) => startOfLocalHour(addDays(today, d), quiet.endHour, timeZone))
    .filter((t) => t > now && !inQuietHours(t, timeZone, quiet))
    .sort((a, b) => a.getTime() - b.getTime())[0];
  // Quiet hours are shorter than a day, so one of the next three ends is
  // always found; a day later is a safe answer if a zone ever proves odd.
  return found ?? new Date(now.getTime() + 24 * HOUR);
}

const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/**
 * When the next digest goes out after `now`: 6 pm local every day, or on
 * Sundays when it is weekly. Always later than `now`.
 */
export function nextDigestAt(
  now: Date,
  timeZone: string,
  frequency: DigestFrequency,
): Date {
  const today = localDate(now, timeZone);
  for (let d = 0; d <= 8; d++) {
    const date = addDays(today, d);
    if (frequency === "weekly" && weekday(date) !== DIGEST_WEEKDAY) continue;
    const at = startOfLocalHour(date, DIGEST_HOUR, timeZone);
    if (at > now) return at;
  }
  // Unreachable: a week always has a Sunday 6 pm after now.
  return new Date(now.getTime() + 7 * 24 * HOUR);
}

export type Delivery = {
  class: DeliveryClass;
  channel: "email" | "push";
  now: Date;
  timeZone: string;
  limits: AlertLimits;
  /** Non-urgent messages already sent to this person today on this channel. */
  sentToday: number;
};

export type Decision =
  /** Send now; a push arrives without sound or vibration when silent. */
  | { action: "send"; silent: boolean }
  /** Quiet hours: queue it again for when they end. */
  | { action: "wait"; until: Date }
  /** Over the cap: hold it for the digest that goes out at `until`. */
  | { action: "hold"; until: Date };

/**
 * What the outbox does with one message for one person now. Urgent ones
 * always go; non-urgent ones wait out quiet hours, then go while the
 * person is under their daily cap and are held for the digest after that;
 * the digest itself waits out quiet hours and is never capped.
 */
export function decide({
  class: kind,
  channel,
  now,
  timeZone,
  limits,
  sentToday,
}: Delivery): Decision {
  const quiet = inQuietHours(now, timeZone, limits.quietHours);
  if (kind === "urgent")
    return { action: "send", silent: quiet && channel === "push" };
  if (quiet)
    return {
      action: "wait",
      until: quietHoursEnd(now, timeZone, limits.quietHours),
    };
  if (kind === "digest" || sentToday < limits.dailyCap)
    return { action: "send", silent: false };
  return { action: "hold", until: nextDigestAt(now, timeZone, limits.digest) };
}

/** The local hour as the settings page shows it: "10 pm", "noon". */
export function hourLabel(h: number): string {
  if (h === 0) return "midnight";
  if (h === 12) return "noon";
  return h < 12 ? `${h} am` : `${h - 12} pm`;
}
