/**
 * Wall-clock times in the league's time zone. Permits are entered as local
 * dates and times ("Mondays 8 to 10 pm") and stored as instants.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** Minutes the zone is ahead of UTC at an instant (negative west of UTC). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/**
 * The instant a wall clock in `timeZone` reads `time` (HH:MM) on `date`
 * (YYYY-MM-DD). A time skipped by a spring-forward change resolves to the
 * instant one hour later on the clock, as most calendars do.
 */
export function zonedInstant(
  date: string,
  time: string,
  timeZone: string,
): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Bad date: ${date}`);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new Error(`Bad time: ${time}`);
  const wall = Date.parse(`${date}T${time}:00Z`);
  const before = offsetMinutes(new Date(wall), timeZone);
  const first = wall - before * 60_000;
  const after = offsetMinutes(new Date(first), timeZone);
  if (after === before) return new Date(first);
  const second = wall - after * 60_000;
  if (offsetMinutes(new Date(second), timeZone) === after)
    return new Date(second);
  // The clock skipped this time: take the later reading, an hour on.
  return new Date(Math.max(first, second));
}

/** The local HH:MM of an instant in a time zone. */
export function localTime(instant: Date, timeZone: string): string {
  const minutes =
    Math.floor(instant.getTime() / 60_000) + offsetMinutes(instant, timeZone);
  const ofDay = ((minutes % 1440) + 1440) % 1440;
  return `${pad(Math.floor(ofDay / 60))}:${pad(ofDay % 60)}`;
}

/** `count` dates a week apart, starting with `first` (YYYY-MM-DD). */
export function weeklyDates(first: string, count: number): string[] {
  const start = Date.parse(`${first}T12:00:00Z`);
  if (Number.isNaN(start)) throw new Error(`Bad date: ${first}`);
  return Array.from({ length: count }, (_, i) =>
    new Date(start + i * 7 * 86_400_000).toISOString().slice(0, 10),
  );
}
