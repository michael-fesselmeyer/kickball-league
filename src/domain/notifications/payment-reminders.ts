import { localDate } from "@/domain/scheduler/slots";

/**
 * When unpaid players are reminded: 7, 3 and 1 days before the payment
 * deadline (product-spec.md, "Payments"), counted in calendar days in the
 * league's time zone.
 */
export const REMINDER_DAYS = [7, 3, 1] as const;
export type ReminderDay = (typeof REMINDER_DAYS)[number];

const DAY_MS = 86_400_000;

/** Whole calendar days from `now` to the deadline, in the league's zone. */
export function daysUntil(deadline: Date, now: Date, timeZone: string): number {
  const toUtcDay = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
  return Math.round(
    (toUtcDay(localDate(deadline, timeZone)) -
      toUtcDay(localDate(now, timeZone))) /
      DAY_MS,
  );
}

/**
 * The reminder that is due today, if any: the closest milestone the deadline
 * is within. A job that missed a day still sends the right one, and each
 * milestone is sent once because its dedupe key names it. Nothing is due
 * once the deadline has passed.
 */
export function dueReminder(
  deadline: Date,
  now: Date,
  timeZone: string,
): { milestone: ReminderDay; daysLeft: number } | null {
  if (now >= deadline) return null;
  const daysLeft = daysUntil(deadline, now, timeZone);
  const milestone = [...REMINDER_DAYS].reverse().find((m) => daysLeft <= m);
  return milestone === undefined ? null : { milestone, daysLeft };
}
