import { and, asc, eq, gte, inArray, lt, ne, or, isNull } from "drizzle-orm";
import {
  clockOf,
  isRealDate,
  type FieldGroup,
  type GroupInput,
  MAX_NOTE,
  type RecordedOverlap,
  type Span,
} from "@/domain/field-groups/groups";
import type {
  FieldGroupId,
  FieldId,
  FieldOverlapId,
  LeagueId,
  UserId,
} from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import { localDate } from "@/domain/scheduler/slots";
import { zonedInstant } from "@/domain/time/zoned";
import { fieldGroup, fieldOverlap } from "../schema/field-groups";
import { field, slot, venue } from "../schema/game";
import { blackout, permitWindow } from "../schema/schedule";
import { recordAudit } from "./audit";
import { required } from "./rows";
import type { Db } from "./schedule";

/**
 * Other groups that use the league's fields (issue #408), and the days two
 * groups hold the same time. Admin-only: callers check `season.manage`, and
 * nothing here is read by a public page or an export, because the group's
 * contact lives in these rows. Changes are audited without the contact.
 */

export type GroupRow = FieldGroup & {
  fieldLabel: string;
  venueName: string;
  lat: number | null;
  lng: number | null;
  contact: string | null;
};

const rowOf = (r: {
  id: FieldGroupId;
  fieldId: FieldId;
  name: string;
  weekdays: number[];
  startsAt: string | null;
  endsAt: string | null;
  contact: string | null;
  fieldName: string;
  venueName: string;
  lat: string | null;
  lng: string | null;
}): GroupRow => ({
  id: r.id,
  fieldId: r.fieldId,
  name: r.name,
  weekdays: r.weekdays,
  startsAt: clockOf(r.startsAt),
  endsAt: clockOf(r.endsAt),
  contact: r.contact,
  fieldLabel: r.fieldName,
  venueName: r.venueName,
  lat: r.lat === null ? null : Number(r.lat),
  lng: r.lng === null ? null : Number(r.lng),
});

const groupColumns = {
  id: fieldGroup.id,
  fieldId: fieldGroup.fieldId,
  name: fieldGroup.name,
  weekdays: fieldGroup.weekdays,
  startsAt: fieldGroup.startsAt,
  endsAt: fieldGroup.endsAt,
  contact: fieldGroup.contact,
  fieldName: field.name,
  venueName: venue.name,
  lat: venue.lat,
  lng: venue.lng,
};

/** Every group on the league's fields, and every overlap recorded for them. */
export async function groupsScreen(db: Db, leagueId: LeagueId) {
  const [groups, overlaps] = await Promise.all([
    db
      .select(groupColumns)
      .from(fieldGroup)
      .innerJoin(field, eq(fieldGroup.fieldId, field.id))
      .innerJoin(venue, eq(field.venueId, venue.id))
      .where(eq(venue.leagueId, leagueId))
      .orderBy(
        asc(venue.name),
        asc(field.sortOrder),
        asc(field.name),
        asc(fieldGroup.name),
      ),
    db
      .select({
        id: fieldOverlap.id,
        groupId: fieldOverlap.groupId,
        group: fieldGroup.name,
        fieldId: fieldGroup.fieldId,
        on: fieldOverlap.onDate,
        note: fieldOverlap.note,
      })
      .from(fieldOverlap)
      .innerJoin(fieldGroup, eq(fieldOverlap.groupId, fieldGroup.id))
      .innerJoin(field, eq(fieldGroup.fieldId, field.id))
      .innerJoin(venue, eq(field.venueId, venue.id))
      .where(eq(venue.leagueId, leagueId))
      .orderBy(asc(fieldOverlap.onDate)),
  ]);
  return {
    groups: groups.map(rowOf),
    overlaps: overlaps satisfies RecordedOverlap[],
  };
}

async function fieldInLeague(db: Db, leagueId: LeagueId, fieldId: FieldId) {
  const [found] = await db
    .select({ id: field.id })
    .from(field)
    .innerJoin(venue, eq(field.venueId, venue.id))
    .where(and(eq(field.id, fieldId), eq(venue.leagueId, leagueId)));
  return found !== undefined;
}

async function groupInLeague(db: Db, leagueId: LeagueId, id: FieldGroupId) {
  const [found] = await db
    .select({ fieldId: fieldGroup.fieldId, name: fieldGroup.name })
    .from(fieldGroup)
    .innerJoin(field, eq(fieldGroup.fieldId, field.id))
    .innerJoin(venue, eq(field.venueId, venue.id))
    .where(and(eq(fieldGroup.id, id), eq(venue.leagueId, leagueId)));
  return found ?? null;
}

const stored = (g: GroupInput) => ({
  name: g.name,
  weekdays: g.weekdays,
  startsAt: g.startsAt,
  endsAt: g.endsAt,
  contact: g.contact,
});

/** What an audit entry keeps: everything but the contact. */
const audited = (g: GroupInput) => ({
  name: g.name,
  weekdays: g.weekdays,
  startsAt: g.startsAt,
  endsAt: g.endsAt,
  hasContact: g.contact !== null,
});

export async function addGroup(
  db: Db,
  input: { leagueId: LeagueId; fieldId: FieldId; group: GroupInput },
  actorId: UserId,
): Promise<Result<FieldGroupId, "unknown_field">> {
  if (!(await fieldInLeague(db, input.leagueId, input.fieldId)))
    return err("unknown_field");
  const [created] = await db
    .insert(fieldGroup)
    .values({
      fieldId: input.fieldId,
      ...stored(input.group),
      createdBy: actorId,
    })
    .returning({ id: fieldGroup.id });
  const id = required(created, "field group").id;
  await recordAudit(db, {
    actorId,
    action: "field_group.create",
    entityType: "field",
    entityId: input.fieldId,
    after: { groupId: id, ...audited(input.group) },
  });
  return ok(id);
}

export async function updateGroup(
  db: Db,
  input: { leagueId: LeagueId; groupId: FieldGroupId; group: GroupInput },
  actorId: UserId,
): Promise<Result<void, "unknown_group">> {
  const found = await groupInLeague(db, input.leagueId, input.groupId);
  if (!found) return err("unknown_group");
  await db
    .update(fieldGroup)
    .set(stored(input.group))
    .where(eq(fieldGroup.id, input.groupId));
  await recordAudit(db, {
    actorId,
    action: "field_group.update",
    entityType: "field",
    entityId: found.fieldId,
    after: { groupId: input.groupId, ...audited(input.group) },
  });
  return ok(undefined);
}

/** Removes a group and, with it, the overlaps recorded against it. */
export async function removeGroup(
  db: Db,
  input: { leagueId: LeagueId; groupId: FieldGroupId },
  actorId: UserId,
): Promise<Result<void, "unknown_group">> {
  const found = await groupInLeague(db, input.leagueId, input.groupId);
  if (!found) return err("unknown_group");
  await db.delete(fieldGroup).where(eq(fieldGroup.id, input.groupId));
  await recordAudit(db, {
    actorId,
    action: "field_group.delete",
    entityType: "field",
    entityId: found.fieldId,
    before: { groupId: input.groupId, name: found.name },
  });
  return ok(undefined);
}

export async function addOverlap(
  db: Db,
  input: {
    leagueId: LeagueId;
    groupId: FieldGroupId;
    on: string;
    note: string;
  },
  actorId: UserId,
): Promise<
  Result<
    FieldOverlapId,
    "unknown_group" | "bad_date" | "bad_note" | "duplicate"
  >
> {
  if (!isRealDate(input.on)) return err("bad_date");
  const note = input.note.trim();
  if (note.length > MAX_NOTE) return err("bad_note");
  const found = await groupInLeague(db, input.leagueId, input.groupId);
  if (!found) return err("unknown_group");
  const [created] = await db
    .insert(fieldOverlap)
    .values({
      groupId: input.groupId,
      onDate: input.on,
      note: note || null,
      createdBy: actorId,
    })
    .onConflictDoNothing()
    .returning({ id: fieldOverlap.id });
  if (!created) return err("duplicate");
  await recordAudit(db, {
    actorId,
    action: "field_overlap.create",
    entityType: "field",
    entityId: found.fieldId,
    after: { groupId: input.groupId, on: input.on },
  });
  return ok(created.id);
}

export async function removeOverlap(
  db: Db,
  input: { leagueId: LeagueId; overlapId: FieldOverlapId },
  actorId: UserId,
): Promise<Result<void, "unknown_overlap">> {
  const [found] = await db
    .select({
      id: fieldOverlap.id,
      groupId: fieldOverlap.groupId,
      on: fieldOverlap.onDate,
      fieldId: fieldGroup.fieldId,
    })
    .from(fieldOverlap)
    .innerJoin(fieldGroup, eq(fieldOverlap.groupId, fieldGroup.id))
    .innerJoin(field, eq(fieldGroup.fieldId, field.id))
    .innerJoin(venue, eq(field.venueId, venue.id))
    .where(
      and(
        eq(fieldOverlap.id, input.overlapId),
        eq(venue.leagueId, input.leagueId),
      ),
    );
  if (!found) return err("unknown_overlap");
  await db.delete(fieldOverlap).where(eq(fieldOverlap.id, input.overlapId));
  await recordAudit(db, {
    actorId,
    action: "field_overlap.delete",
    entityType: "field",
    entityId: found.fieldId,
    before: { groupId: found.groupId, on: found.on },
  });
  return ok(undefined);
}

/**
 * What the overlap warnings need to know about the days they fall on, for
 * `today` on: the fields and days the league still holds a permit, the days
 * every slot on a field is cancelled, and the blackout dates. Three reads.
 */
export async function overlapDays(
  db: Db,
  input: {
    overlaps: readonly RecordedOverlap[];
    timeZone: string;
  },
) {
  const held = new Set<string>();
  const rainedOut = new Set<string>();
  const blackouts = new Set<string>();
  if (input.overlaps.length === 0) return { held, rainedOut, blackouts };
  const dates = input.overlaps.map((o) => o.on).sort();
  const first = dates[0]!;
  const last = dates[dates.length - 1]!;
  const from = zonedInstant(first, "00:00", input.timeZone);
  // A day past the last, so its whole local day is inside the range.
  const to = new Date(
    zonedInstant(last, "00:00", input.timeZone).getTime() + 26 * 3_600_000,
  );
  const fields = [
    ...new Set(input.overlaps.map((o) => o.fieldId)),
  ] as FieldId[];
  const [windows, slots, blackoutRows] = await Promise.all([
    db
      .select({
        fieldId: permitWindow.fieldId,
        startsAt: permitWindow.startsAt,
      })
      .from(permitWindow)
      .where(
        and(
          inArray(permitWindow.fieldId, fields),
          ne(permitWindow.status, "lost"),
          gte(permitWindow.startsAt, from),
          lt(permitWindow.startsAt, to),
        ),
      ),
    db
      .select({
        fieldId: slot.fieldId,
        startsAt: slot.startsAt,
        status: slot.status,
      })
      .from(slot)
      .where(
        and(
          inArray(slot.fieldId, fields),
          gte(slot.startsAt, from),
          lt(slot.startsAt, to),
        ),
      ),
    db
      .select({ onDate: blackout.onDate, fieldId: blackout.fieldId })
      .from(blackout)
      .where(
        and(
          inArray(blackout.onDate, dates),
          or(isNull(blackout.fieldId), inArray(blackout.fieldId, fields)),
        ),
      ),
  ]);
  for (const w of windows)
    held.add(`${localDate(w.startsAt, input.timeZone)}/${w.fieldId}`);
  const open = new Set<string>();
  const cancelled = new Set<string>();
  for (const s of slots) {
    const key = `${localDate(s.startsAt, input.timeZone)}/${s.fieldId}`;
    (s.status === "cancelled" ? cancelled : open).add(key);
  }
  for (const key of cancelled) if (!open.has(key)) rainedOut.add(key);
  for (const b of blackoutRows)
    blackouts.add(b.fieldId ? `${b.onDate}/${b.fieldId}` : b.onDate);
  return { held, rainedOut, blackouts };
}

/**
 * The groups at each field a game day uses, and the league's hold on each
 * that day (its permit windows, else its open slots; lost permits don't
 * count): the first start to the last end. Three reads. A field with no hold
 * that day is left out, and so is one no group uses or whose slots are all
 * cancelled (a rain-out: the league isn't there to hand over).
 */
export async function handoverInputs(
  db: Db,
  input: {
    leagueId: LeagueId;
    fieldIds: readonly FieldId[];
    date: string;
    timeZone: string;
  },
): Promise<
  {
    fieldId: FieldId;
    groups: GroupRow[];
    ours: Span;
  }[]
> {
  if (input.fieldIds.length === 0) return [];
  const from = zonedInstant(input.date, "00:00", input.timeZone);
  const to = new Date(from.getTime() + 25 * 3_600_000);
  const fieldIds = [...input.fieldIds];
  const [groups, windows, slots] = await Promise.all([
    db
      .select(groupColumns)
      .from(fieldGroup)
      .innerJoin(field, eq(fieldGroup.fieldId, field.id))
      .innerJoin(venue, eq(field.venueId, venue.id))
      .where(
        and(
          inArray(fieldGroup.fieldId, fieldIds),
          eq(venue.leagueId, input.leagueId),
        ),
      )
      .orderBy(asc(fieldGroup.name)),
    db
      .select({
        fieldId: permitWindow.fieldId,
        startsAt: permitWindow.startsAt,
        endsAt: permitWindow.endsAt,
      })
      .from(permitWindow)
      .where(
        and(
          inArray(permitWindow.fieldId, fieldIds),
          ne(permitWindow.status, "lost"),
          gte(permitWindow.startsAt, from),
          lt(permitWindow.startsAt, to),
        ),
      ),
    db
      .select({
        fieldId: slot.fieldId,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        status: slot.status,
      })
      .from(slot)
      .where(
        and(
          inArray(slot.fieldId, fieldIds),
          gte(slot.startsAt, from),
          lt(slot.startsAt, to),
        ),
      ),
  ]);
  const onDay = <T extends { startsAt: Date }>(rows: T[]) =>
    rows.filter((r) => localDate(r.startsAt, input.timeZone) === input.date);
  const span = (rows: { startsAt: Date; endsAt: Date }[]): Span | null =>
    rows.length === 0
      ? null
      : {
          start: new Date(Math.min(...rows.map((r) => r.startsAt.getTime()))),
          end: new Date(Math.max(...rows.map((r) => r.endsAt.getTime()))),
        };
  const out = [];
  for (const fieldId of new Set(groups.map((g) => g.fieldId))) {
    const mine = onDay(slots.filter((s) => s.fieldId === fieldId));
    const open = mine.filter((s) => s.status !== "cancelled");
    // Every slot called off (a rain-out): the league isn't there to hand over.
    if (mine.length > 0 && open.length === 0) continue;
    const ours =
      span(onDay(windows.filter((w) => w.fieldId === fieldId))) ?? span(open);
    if (!ours) continue;
    out.push({
      fieldId,
      groups: groups.filter((g) => g.fieldId === fieldId).map(rowOf),
      ours,
    });
  }
  return out;
}

/** The overlaps recorded for one day, with the field each is on. */
export async function overlapsOn(
  db: Db,
  input: { leagueId: LeagueId; date: string },
): Promise<RecordedOverlap[]> {
  return db
    .select({
      id: fieldOverlap.id,
      groupId: fieldOverlap.groupId,
      group: fieldGroup.name,
      fieldId: fieldGroup.fieldId,
      on: fieldOverlap.onDate,
      note: fieldOverlap.note,
    })
    .from(fieldOverlap)
    .innerJoin(fieldGroup, eq(fieldOverlap.groupId, fieldGroup.id))
    .innerJoin(field, eq(fieldGroup.fieldId, field.id))
    .innerJoin(venue, eq(field.venueId, venue.id))
    .where(
      and(
        eq(venue.leagueId, input.leagueId),
        eq(fieldOverlap.onDate, input.date),
      ),
    )
    .orderBy(asc(fieldGroup.name));
}
