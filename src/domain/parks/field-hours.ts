import { dateTimeFormat } from "@/domain/time/format-cache";
import { localTime } from "@/domain/time/zoned";

/**
 * Who holds which field when, for a park's public page. Permit windows are
 * stored as instants; the page shows them as the wall clock in the league's
 * time zone, grouped by the local date they start on.
 */

export type ParkWindow = {
  fieldId: string;
  fieldName: string;
  /** Position of the field in the park, for ordering. */
  sortOrder: number;
  startsAt: Date;
  endsAt: Date;
  permitNumber: string | null;
};

export type FieldHours = {
  fieldId: string;
  fieldName: string;
  /** The window as the wall clock reads, e.g. "6:00 PM to 10:00 PM". */
  startsAt: Date;
  endsAt: Date;
  /** The permit number the windows share; null when none is recorded. */
  permitNumbers: string[];
  /** True when the window ends on a later calendar day than it starts. */
  endsNextDay: boolean;
};

export type ParkDay = {
  /** YYYY-MM-DD in the league's time zone. */
  date: string;
  fields: FieldHours[];
};

/** The local YYYY-MM-DD of an instant in a time zone. */
export function localDate(instant: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    dateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Merge windows of one field that touch or overlap (a permit cut in two
 * halves, or two permits back to back), keeping every permit number that
 * covers the time. Windows with a gap between them stay separate: a field
 * can be held for 8 to 10 am and again for 6 to 9 pm.
 */
function mergeTouching(windows: readonly ParkWindow[]): FieldHours[] {
  const sorted = [...windows].sort(
    (a, b) =>
      a.sortOrder - b.sortOrder ||
      a.fieldName.localeCompare(b.fieldName) ||
      a.startsAt.getTime() - b.startsAt.getTime(),
  );
  const out: (FieldHours & { sortOrder: number })[] = [];
  for (const w of sorted) {
    const last = out[out.length - 1];
    if (
      last &&
      last.fieldId === w.fieldId &&
      w.startsAt.getTime() <= last.endsAt.getTime()
    ) {
      if (w.endsAt > last.endsAt) last.endsAt = w.endsAt;
      if (w.permitNumber && !last.permitNumbers.includes(w.permitNumber))
        last.permitNumbers.push(w.permitNumber);
      continue;
    }
    out.push({
      fieldId: w.fieldId,
      fieldName: w.fieldName,
      startsAt: w.startsAt,
      endsAt: w.endsAt,
      permitNumbers: w.permitNumber ? [w.permitNumber] : [],
      endsNextDay: false,
      sortOrder: w.sortOrder,
    });
  }
  return out;
}

/**
 * The park's permitted days that are not over at `now`, soonest first, at
 * most `limit` of them. A window that has already ended is left out; one
 * that is under way stays, so the page is right all through the evening. A
 * window that runs past midnight belongs to the day it starts on.
 */
export function parkDays(
  windows: readonly ParkWindow[],
  now: Date,
  timeZone: string,
  limit: number,
): ParkDay[] {
  const open = windows.filter((w) => w.endsAt > now);
  const byDate = new Map<string, ParkWindow[]>();
  for (const w of open) {
    const date = localDate(w.startsAt, timeZone);
    byDate.set(date, [...(byDate.get(date) ?? []), w]);
  }
  return [...byDate.keys()]
    .sort()
    .slice(0, limit)
    .map((date) => ({
      date,
      fields: mergeTouching(byDate.get(date) ?? []).map((f) => ({
        fieldId: f.fieldId,
        fieldName: f.fieldName,
        startsAt: f.startsAt,
        endsAt: f.endsAt,
        permitNumbers: f.permitNumbers,
        endsNextDay: localDate(f.endsAt, timeZone) !== date,
      })),
    }));
}

/** "6:00 PM" from an instant, in the league's zone. */
export function clockText(instant: Date, timeZone: string): string {
  const [h = 0, m = 0] = localTime(instant, timeZone).split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "6:00 PM to 10:00 PM", with "(next day)" when it runs past midnight. */
export function rangeText(f: FieldHours, timeZone: string): string {
  return `${clockText(f.startsAt, timeZone)} to ${clockText(f.endsAt, timeZone)}${
    f.endsNextDay ? " (next day)" : ""
  }`;
}

/** "Tuesday, November 17" for a YYYY-MM-DD date. */
export function dayText(date: string): string {
  return dateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}
