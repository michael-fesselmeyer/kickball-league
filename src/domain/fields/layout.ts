/**
 * Field layouts (issue #403): what a field has on file, and which of a
 * season's fields still need an answer before its schedule is published.
 */

export const MAX_LAYOUT_NOTE = 280;

export type LayoutState = "layout" | "none_needed" | "missing";

/** What a field has: a layout, an admin's "no layout needed", or nothing. */
export function layoutState(
  row: {
    fileId: string | null;
    noLayoutNeeded: boolean;
  } | null,
): LayoutState {
  if (!row) return "missing";
  if (row.fileId !== null) return "layout";
  return row.noLayoutNeeded ? "none_needed" : "missing";
}

/** A note from the form: trimmed, empty as null, or "too_long". */
export function parseLayoutNote(raw: string): string | null | "too_long" {
  const note = raw.trim().replace(/\s+/g, " ");
  if (note === "") return null;
  return note.length > MAX_LAYOUT_NOTE ? "too_long" : note;
}
