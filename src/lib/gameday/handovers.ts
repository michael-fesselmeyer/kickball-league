import { db } from "@/db/client";
import { handoverInputs, overlapsOn } from "@/db/queries/field-groups";
import { nextHandovers } from "@/domain/field-groups/groups";
import { permitOfficeFor } from "@/domain/field-groups/office";
import type { FieldId, LeagueId } from "@/domain/ids";

/** The part of a game the handovers need; the command center's rows fit. */
export type HandoverRow = {
  id: string;
  fieldId: string;
  fieldName: string;
  venue: { name: string } | null;
  startsAt: Date;
  slotCancelled: boolean;
  status: string;
};

/** One field's handovers for the day, as plain data the board can tick on. */
export type FieldHandovers = {
  fieldId: string;
  /** "Field 1, McCarren Park". */
  label: string;
  /** Soonest first; the board shows the first one still ahead of the clock. */
  handovers: {
    group: string;
    kind: "after" | "before" | "overlap";
    /** ISO instants. */
    at: string;
    usual: string;
    /** Admin-only, phone or email; null when none was recorded. */
    contact: string | null;
  }[];
  /** Groups on this field with no usual hours: named, never counted down. */
  noHours: { group: string; contact: string | null }[];
  /** An overlap an admin recorded for this day. */
  overlaps: { group: string; note: string | null }[];
  office: { name: string; phone: string | null; page: string };
  /** A game on the field to hang an incident report on. */
  incidentGameId: string | null;
};

/**
 * What the command center shows about other groups at each field in use
 * today (issue #408): the next handover with its countdown, groups with no
 * usual hours, and any overlap recorded for the day. Contacts are admin-only:
 * they are read only for an admin's screen. A few reads, however
 * many fields: the groups and the league's hold, and the day's overlaps.
 * A field none of this applies to is left out.
 */
export async function loadHandovers(input: {
  leagueId: LeagueId;
  date: string;
  timeZone: string;
  now: Date;
  rows: readonly HandoverRow[];
  /**
   * Admins see each group's contact and get the incident link. The set-up
   * lead is not an admin: no contact is read at all, and no incident link.
   */
  forAdmin: boolean;
}): Promise<FieldHandovers[]> {
  const playing = input.rows.filter(
    (r) => !r.slotCancelled && r.status !== "cancelled",
  );
  const fieldIds = [...new Set(playing.map((r) => r.fieldId))] as FieldId[];
  if (fieldIds.length === 0) return [];
  const [inputs, overlaps] = await Promise.all([
    handoverInputs(db, {
      leagueId: input.leagueId,
      withContact: input.forAdmin,
      fieldIds,
      date: input.date,
      timeZone: input.timeZone,
    }),
    overlapsOn(db, { leagueId: input.leagueId, date: input.date }),
  ]);
  const out: FieldHandovers[] = [];
  for (const f of inputs) {
    const games = playing.filter((r) => r.fieldId === f.fieldId);
    const first = games[0];
    if (!first) continue;
    // The game to report on: the latest that has started, else the first.
    const started = games.filter(
      (g) => g.startsAt.getTime() <= input.now.getTime(),
    );
    const contactOf = new Map(f.groups.map((g) => [g.id, g.contact]));
    const handovers = nextHandovers({
      groups: f.groups,
      ours: f.ours,
      date: input.date,
      timeZone: input.timeZone,
      now: input.now,
    }).map((h) => ({
      group: h.group,
      kind: h.kind,
      at: h.at.toISOString(),
      usual: h.usual.toISOString(),
      contact: contactOf.get(h.groupId) ?? null,
    }));
    const recorded = overlaps.filter((o) => o.fieldId === f.fieldId);
    const noHours = f.groups
      .filter((g) => g.weekdays.length === 0)
      .map((g) => ({ group: g.name, contact: g.contact }));
    if (handovers.length === 0 && noHours.length === 0 && recorded.length === 0)
      continue;
    const where = f.groups[0];
    out.push({
      fieldId: f.fieldId,
      label: `${first.fieldName}${first.venue ? `, ${first.venue.name}` : ""}`,
      handovers,
      noHours,
      overlaps: recorded.map((o) => ({ group: o.group, note: o.note })),
      office: permitOfficeFor(
        where?.lat != null && where.lng != null
          ? { lat: where.lat, lng: where.lng }
          : null,
        first.fieldName,
      ),
      incidentGameId: input.forAdmin ? (started.at(-1) ?? first).id : null,
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}
