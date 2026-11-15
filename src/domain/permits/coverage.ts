import { err, ok, type Result } from "@/domain/result";
import { kickoff, shortDay } from "@/domain/schedule/format";

/**
 * Permit coverage (issue #407): whether the league holds a field for the
 * whole time something is posted there. A permit window counts when it has
 * an uploaded document and was not marked lost; windows that touch or
 * overlap on a field count as one stretch. Pure, so the scheduler's hard
 * constraints, the posting forms, the permits screen and the owners' email
 * all judge coverage the same way.
 *
 * Instants are ISO-8601 strings or Dates, as the scheduler and the
 * database each hold them.
 */

type Instant = string | Date;

export type CoverWindow = {
  fieldId: string;
  startsAt: Instant;
  endsAt: Instant;
  status: "requested" | "confirmed" | "lost";
  hasDocument: boolean;
};

/** Something posted on a field from one instant to another. */
export type Span = { fieldId: string; startsAt: Instant; endsAt: Instant };

export type CoverageGap =
  /** No permit window on the field at that time at all. */
  | { kind: "no_permit" }
  /** The only permit for that time was marked lost. */
  | { kind: "lost" }
  /** The permit for that time has no document uploaded. */
  | { kind: "no_document" }
  /** A permit covers the end, but starts after the span does. */
  | { kind: "starts_early"; permittedFrom: Date }
  /** A permit covers the start, but ends before the span does. */
  | { kind: "ends_late"; permittedUntil: Date };

const ms = (at: Instant) =>
  typeof at === "string" ? Date.parse(at) : at.getTime();

/** Whether a window holds the field: a document, and not lost. */
export const usable = (w: CoverWindow): boolean =>
  w.status !== "lost" && w.hasDocument;

/** Usable windows on one field merged into stretches, earliest first. */
function stretches(fieldId: string, windows: readonly CoverWindow[]) {
  const sorted = windows
    .filter((w) => w.fieldId === fieldId && usable(w))
    .map((w) => ({ start: ms(w.startsAt), end: ms(w.endsAt) }))
    .sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const w of sorted) {
    const last = merged.at(-1);
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
    else merged.push({ ...w });
  }
  return merged;
}

/**
 * What keeps a span from being covered, or null when a usable permit holds
 * its field for all of it.
 */
export function coverageGap(
  span: Span,
  windows: readonly CoverWindow[],
): CoverageGap | null {
  const start = ms(span.startsAt);
  const end = ms(span.endsAt);
  const held = stretches(span.fieldId, windows);
  const around = held.find((h) => h.start <= start && start < h.end);
  if (around)
    return around.end >= end
      ? null
      : { kind: "ends_late", permittedUntil: new Date(around.end) };
  const later = held.find((h) => start < h.start && h.start < end);
  if (later)
    return { kind: "starts_early", permittedFrom: new Date(later.start) };
  const overlapping = windows.filter(
    (w) =>
      w.fieldId === span.fieldId &&
      ms(w.startsAt) < end &&
      start < ms(w.endsAt),
  );
  if (overlapping.some((w) => w.status !== "lost" && !w.hasDocument))
    return { kind: "no_document" };
  if (overlapping.some((w) => w.status === "lost")) return { kind: "lost" };
  return { kind: "no_permit" };
}

/**
 * The gap in one sentence, for the admin who tried to post: "Field 3 is
 * permitted until 8:00 PM; this game ends at 8:20 PM."
 */
export function gapSentence(
  gap: CoverageGap,
  item: {
    fieldName: string;
    startsAt: Instant;
    endsAt: Instant;
    /** "game", "event", "pickup", … */
    noun: string;
  },
  timeZone: string,
): string {
  const at = (i: Instant) => kickoff(new Date(ms(i)), timeZone);
  const field = item.fieldName;
  switch (gap.kind) {
    case "ends_late":
      return `${field} is permitted until ${at(gap.permittedUntil)}; this ${item.noun} ends at ${at(item.endsAt)}.`;
    case "starts_early":
      return `${field} is permitted from ${at(gap.permittedFrom)}; this ${item.noun} starts at ${at(item.startsAt)}.`;
    case "no_document":
      return `${field}'s permit for that time has no document uploaded yet; an owner adds it on the permits screen.`;
    case "lost":
      return `${field}'s permit for that time was marked lost.`;
    case "no_permit":
      return `No permit covers ${field} on ${shortDay(new Date(ms(item.startsAt)), timeZone)} from ${at(item.startsAt)} to ${at(item.endsAt)}.`;
  }
}

/**
 * The one gap an owner or admin may override (ADR 0066): the league holds
 * the permit, but its document isn't uploaded yet. A lost permit, no
 * permit, or hours that fall short are never overridden.
 */
export const OVERRIDABLE: CoverageGap["kind"] = "no_document";

/**
 * The windows as they would count with every document in hand: what an
 * override of missing documents is judged against. Lost windows still
 * don't count.
 */
export function waiveDocuments(windows: readonly CoverWindow[]): CoverWindow[] {
  return windows.map((w) => ({ ...w, hasDocument: true }));
}

export const OVERRIDE_REASON_MIN = 10;
export const OVERRIDE_REASON_MAX = 300;

/**
 * The typed reason for publishing or posting before the permit's document
 * is uploaded, kept in the audit log: "Permit 1234 issued, PDF coming
 * Monday".
 */
export function parseOverrideReason(
  raw: unknown,
): Result<string, "reason_short" | "reason_long"> {
  const reason = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (reason.length < OVERRIDE_REASON_MIN) return err("reason_short");
  if (reason.length > OVERRIDE_REASON_MAX) return err("reason_long");
  return ok(reason);
}
