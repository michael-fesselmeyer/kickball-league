import type { Blackout, PermitWindow, Slot, SlotFormat } from "./types";

const MINUTE = 60_000;

/** The local YYYY-MM-DD of an instant in a time zone. */
export function localDate(instant: Date, timeZone: string): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/**
 * Cuts permit windows into back-to-back game slots (scheduling-algorithm.md,
 * section 1, and property P14). Permits and blackouts are applied here, so
 * the scheduler can never place a game outside a permit (H3).
 *
 * - A slot must fit entirely inside its window; a leftover shorter than a
 *   slot is dropped.
 * - Blackouts remove a whole date, or one field on a date.
 * - Overlapping windows on one field never produce overlapping slots.
 * - timeIndex follows clock order across all fields on each date.
 */
export function generateSlots(
  permitWindows: readonly PermitWindow[],
  blackouts: readonly Blackout[],
  format: SlotFormat,
): Slot[] {
  if (!(format.slotMinutes > 0))
    throw new Error("slotMinutes must be positive");
  const length = format.slotMinutes * MINUTE;
  const blocked = (date: string, fieldId: string) =>
    blackouts.some(
      (b) =>
        b.date === date && (b.fieldId === undefined || b.fieldId === fieldId),
    );

  const candidates: Omit<Slot, "timeIndex">[] = [];
  const windows = [...permitWindows].sort(
    (a, b) =>
      a.fieldId.localeCompare(b.fieldId) ||
      a.startsAt.localeCompare(b.startsAt),
  );
  for (const window of windows) {
    const end = Date.parse(window.endsAt);
    for (
      let start = Date.parse(window.startsAt);
      start + length <= end;
      start += length
    ) {
      const startsAt = new Date(start);
      const date = localDate(startsAt, format.timeZone);
      if (blocked(date, window.fieldId)) continue;
      const overlaps = candidates.some(
        (s) =>
          s.fieldId === window.fieldId &&
          Date.parse(s.startsAt) < start + length &&
          start < Date.parse(s.endsAt),
      );
      if (overlaps) continue;
      candidates.push({
        id: `${window.fieldId}@${startsAt.toISOString()}`,
        fieldId: window.fieldId,
        date,
        startsAt: startsAt.toISOString(),
        endsAt: new Date(start + length).toISOString(),
        kind: window.kind ?? "regular",
      });
    }
  }

  // timeIndex: rank of the slot's start among distinct start times that day.
  const slots: Slot[] = [];
  for (const day of Map.groupBy(candidates, (slot) => slot.date).values()) {
    const starts = [...new Set(day.map((slot) => slot.startsAt))].sort();
    for (const slot of day)
      slots.push({ ...slot, timeIndex: starts.indexOf(slot.startsAt) });
  }
  return slots.sort(
    (a, b) =>
      a.startsAt.localeCompare(b.startsAt) ||
      a.fieldId.localeCompare(b.fieldId),
  );
}
