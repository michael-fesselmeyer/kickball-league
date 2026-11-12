import { and, asc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type {
  BlackoutId,
  FieldId,
  LeagueId,
  PermitWindowId,
  SeasonId,
  SlotId,
  UserId,
  VenueId,
} from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import { generateSlots } from "@/domain/scheduler/slots";
import { slugify } from "@/domain/slug";
import { zonedInstant } from "@/domain/time/zoned";
import { field, game, slot, venue } from "../schema/game";
import { blackout, gamePlacement, permitWindow } from "../schema/schedule";
import { recordAudit } from "./audit";
import type { Db } from "./schedule";

/**
 * Venues, fields, permit windows and blackouts, and the slots cut from them
 * (product-spec.md: "Enter fields, permit windows and blackout dates").
 * Every change is audited in the same transaction.
 */

export type PermitStatus = "requested" | "confirmed" | "lost";

export { slugify };

export async function fieldsScreen(
  db: Db,
  leagueId: LeagueId,
  seasonId: SeasonId,
) {
  const venues = await db
    .select({
      id: venue.id,
      name: venue.name,
      address: venue.address,
      neighborhood: venue.neighborhood,
    })
    .from(venue)
    .where(eq(venue.leagueId, leagueId))
    .orderBy(asc(venue.name));
  const fields = await db
    .select({
      id: field.id,
      venueId: field.venueId,
      name: field.name,
      venueName: venue.name,
    })
    .from(field)
    .innerJoin(venue, eq(field.venueId, venue.id))
    .where(eq(venue.leagueId, leagueId))
    .orderBy(asc(venue.name), asc(field.sortOrder), asc(field.name));
  const permits = await db
    .select({
      id: permitWindow.id,
      fieldId: permitWindow.fieldId,
      startsAt: permitWindow.startsAt,
      endsAt: permitWindow.endsAt,
      permitNumber: permitWindow.permitNumber,
      status: permitWindow.status,
    })
    .from(permitWindow)
    .innerJoin(field, eq(permitWindow.fieldId, field.id))
    .where(eq(permitWindow.seasonId, seasonId))
    .orderBy(asc(permitWindow.startsAt), asc(field.sortOrder), asc(field.name));
  const blackouts = await db
    .select({
      id: blackout.id,
      onDate: blackout.onDate,
      fieldId: blackout.fieldId,
      reason: blackout.reason,
    })
    .from(blackout)
    .where(eq(blackout.seasonId, seasonId))
    .orderBy(asc(blackout.onDate));
  const slots = await db
    .select({
      id: slot.id,
      fieldId: slot.fieldId,
      permitWindowId: slot.permitWindowId,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      timeIndex: slot.timeIndex,
      kind: slot.kind,
      status: slot.status,
    })
    .from(slot)
    .where(eq(slot.seasonId, seasonId))
    .orderBy(asc(slot.startsAt), asc(slot.fieldId));
  return {
    venues: venues.map((v) => ({
      ...v,
      fields: fields.filter((f) => f.venueId === v.id),
    })),
    fields,
    permits,
    blackouts,
    slots,
  };
}

export async function addVenue(
  db: Db,
  input: {
    leagueId: LeagueId;
    name: string;
    address?: string;
    neighborhood?: string;
  },
  actorId: UserId,
): Promise<Result<VenueId, "invalid_name" | "duplicate">> {
  const name = input.name.trim();
  const slug = slugify(name);
  if (!slug) return err("invalid_name");
  const [taken] = await db
    .select({ id: venue.id })
    .from(venue)
    .where(and(eq(venue.leagueId, input.leagueId), eq(venue.slug, slug)));
  if (taken) return err("duplicate");
  const [created] = await db
    .insert(venue)
    .values({
      leagueId: input.leagueId,
      name,
      slug,
      address: input.address?.trim() || null,
      neighborhood: input.neighborhood?.trim() || null,
      createdBy: actorId,
    })
    .returning({ id: venue.id });
  const id = (created as { id: VenueId }).id;
  await recordAudit(db, {
    actorId,
    action: "venue.create",
    entityType: "venue",
    entityId: id,
    after: { name, slug },
  });
  return ok(id);
}

export async function addField(
  db: Db,
  input: { leagueId: LeagueId; venueId: VenueId; name: string },
  actorId: UserId,
): Promise<Result<FieldId, "invalid_name" | "unknown_venue" | "duplicate">> {
  const name = input.name.trim();
  if (!name) return err("invalid_name");
  const [owner] = await db
    .select({ id: venue.id })
    .from(venue)
    .where(
      and(eq(venue.id, input.venueId), eq(venue.leagueId, input.leagueId)),
    );
  if (!owner) return err("unknown_venue");
  const siblings = await db
    .select({ name: field.name })
    .from(field)
    .where(eq(field.venueId, input.venueId));
  if (siblings.some((f) => f.name.toLowerCase() === name.toLowerCase()))
    return err("duplicate");
  const [created] = await db
    .insert(field)
    .values({
      venueId: input.venueId,
      name,
      sortOrder: siblings.length,
      createdBy: actorId,
    })
    .returning({ id: field.id });
  const id = (created as { id: FieldId }).id;
  await recordAudit(db, {
    actorId,
    action: "field.create",
    entityType: "field",
    entityId: id,
    after: { venueId: input.venueId, name },
  });
  return ok(id);
}

/** Whether a field belongs to the league, so forms cannot reach other leagues. */
async function fieldInLeague(db: Db, leagueId: LeagueId, fieldId: FieldId) {
  const [found] = await db
    .select({ id: field.id })
    .from(field)
    .innerJoin(venue, eq(field.venueId, venue.id))
    .where(and(eq(field.id, fieldId), eq(venue.leagueId, leagueId)));
  return found !== undefined;
}

export type PermitInput = {
  leagueId: LeagueId;
  seasonId: SeasonId;
  fieldId: FieldId;
  /** Local dates (YYYY-MM-DD), one window each. */
  dates: string[];
  /** Local HH:MM. */
  startTime: string;
  endTime: string;
  timeZone: string;
  permitNumber?: string;
  status: PermitStatus;
};

/** Adds the same permit hours on several dates, such as every Monday. */
export async function addPermitWindows(
  db: Db,
  input: PermitInput,
  actorId: UserId,
): Promise<Result<number, "unknown_field" | "no_dates" | "end_before_start">> {
  if (!(await fieldInLeague(db, input.leagueId, input.fieldId)))
    return err("unknown_field");
  if (input.dates.length === 0) return err("no_dates");
  const rows = input.dates.map((date) => ({
    fieldId: input.fieldId,
    seasonId: input.seasonId,
    startsAt: zonedInstant(date, input.startTime, input.timeZone),
    endsAt: zonedInstant(date, input.endTime, input.timeZone),
    permitNumber: input.permitNumber?.trim() || null,
    status: input.status,
    createdBy: actorId,
  }));
  if (rows.some((r) => r.endsAt <= r.startsAt)) return err("end_before_start");
  await db.insert(permitWindow).values(rows);
  await recordAudit(db, {
    actorId,
    action: "permit.create",
    entityType: "season",
    entityId: input.seasonId,
    after: {
      fieldId: input.fieldId,
      dates: input.dates,
      startTime: input.startTime,
      endTime: input.endTime,
      status: input.status,
    },
  });
  return ok(rows.length);
}

export async function setPermitStatus(
  db: Db,
  input: { seasonId: SeasonId; permitId: PermitWindowId; status: PermitStatus },
  actorId: UserId,
): Promise<Result<void, "unknown_permit">> {
  const [before] = await db
    .select({ status: permitWindow.status })
    .from(permitWindow)
    .where(
      and(
        eq(permitWindow.id, input.permitId),
        eq(permitWindow.seasonId, input.seasonId),
      ),
    );
  if (!before) return err("unknown_permit");
  await db
    .update(permitWindow)
    .set({ status: input.status })
    .where(eq(permitWindow.id, input.permitId));
  await recordAudit(db, {
    actorId,
    action: "permit.update",
    entityType: "permit_window",
    entityId: input.permitId,
    before,
    after: { status: input.status },
  });
  return ok(undefined);
}

/** Deletes a permit no slot was cut from yet; otherwise mark it lost. */
export async function removePermitWindow(
  db: Db,
  input: { seasonId: SeasonId; permitId: PermitWindowId },
  actorId: UserId,
): Promise<Result<void, "unknown_permit" | "has_slots">> {
  const [found] = await db
    .select({
      fieldId: permitWindow.fieldId,
      startsAt: permitWindow.startsAt,
      endsAt: permitWindow.endsAt,
    })
    .from(permitWindow)
    .where(
      and(
        eq(permitWindow.id, input.permitId),
        eq(permitWindow.seasonId, input.seasonId),
      ),
    );
  if (!found) return err("unknown_permit");
  const [cut] = await db
    .select({ id: slot.id })
    .from(slot)
    .where(eq(slot.permitWindowId, input.permitId))
    .limit(1);
  if (cut) return err("has_slots");
  await db.delete(permitWindow).where(eq(permitWindow.id, input.permitId));
  await recordAudit(db, {
    actorId,
    action: "permit.delete",
    entityType: "permit_window",
    entityId: input.permitId,
    before: found,
  });
  return ok(undefined);
}

export async function addBlackout(
  db: Db,
  input: {
    leagueId: LeagueId;
    seasonId: SeasonId;
    onDate: string;
    fieldId: FieldId | null;
    reason?: string;
  },
  actorId: UserId,
): Promise<Result<BlackoutId, "unknown_field" | "bad_date" | "duplicate">> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.onDate)) return err("bad_date");
  if (
    input.fieldId !== null &&
    !(await fieldInLeague(db, input.leagueId, input.fieldId))
  )
    return err("unknown_field");
  const existing = await db
    .select({ fieldId: blackout.fieldId })
    .from(blackout)
    .where(
      and(
        eq(blackout.seasonId, input.seasonId),
        eq(blackout.onDate, input.onDate),
      ),
    );
  if (existing.some((b) => b.fieldId === input.fieldId))
    return err("duplicate");
  const [created] = await db
    .insert(blackout)
    .values({
      seasonId: input.seasonId,
      onDate: input.onDate,
      fieldId: input.fieldId,
      reason: input.reason?.trim() || null,
      createdBy: actorId,
    })
    .returning({ id: blackout.id });
  const id = (created as { id: BlackoutId }).id;
  await recordAudit(db, {
    actorId,
    action: "blackout.create",
    entityType: "season",
    entityId: input.seasonId,
    after: { onDate: input.onDate, fieldId: input.fieldId },
  });
  return ok(id);
}

export async function removeBlackout(
  db: Db,
  input: { seasonId: SeasonId; blackoutId: BlackoutId },
  actorId: UserId,
): Promise<Result<void, "unknown_blackout">> {
  const [found] = await db
    .delete(blackout)
    .where(
      and(
        eq(blackout.id, input.blackoutId),
        eq(blackout.seasonId, input.seasonId),
      ),
    )
    .returning({ onDate: blackout.onDate, fieldId: blackout.fieldId });
  if (!found) return err("unknown_blackout");
  await recordAudit(db, {
    actorId,
    action: "blackout.delete",
    entityType: "season",
    entityId: input.seasonId,
    before: found,
  });
  return ok(undefined);
}

export type SlotSync = {
  /** New slots. */
  added: number;
  /** Slots that already existed, with their time index refreshed. */
  kept: number;
  /** Slots no permit covers any more, deleted. */
  removed: number;
  /** Slots no permit covers any more that a schedule version uses: cancelled, not deleted. */
  retired: number;
};

/**
 * Makes the season's slots match its permits and blackouts: cuts every
 * requested or confirmed permit window into slots of `slotMinutes`
 * (generateSlots, so H3 holds). A slot keeps its id when its field and start
 * are unchanged, so schedule versions that use it stay intact. A slot no
 * longer covered is deleted, or cancelled when a version uses it. Slots that
 * were not cut from a permit are left alone unless a permit now covers them.
 */
export async function syncSlots(
  db: Db,
  input: { seasonId: SeasonId; slotMinutes: number; timeZone: string },
  actorId: UserId,
): Promise<Result<SlotSync, "bad_length">> {
  if (
    !Number.isInteger(input.slotMinutes) ||
    input.slotMinutes < 15 ||
    input.slotMinutes > 480
  )
    return err("bad_length");
  const windows = await db
    .select({
      id: permitWindow.id,
      fieldId: permitWindow.fieldId,
      startsAt: permitWindow.startsAt,
      endsAt: permitWindow.endsAt,
    })
    .from(permitWindow)
    .where(
      and(
        eq(permitWindow.seasonId, input.seasonId),
        ne(permitWindow.status, "lost"),
      ),
    );
  const blackouts = await db
    .select({ onDate: blackout.onDate, fieldId: blackout.fieldId })
    .from(blackout)
    .where(eq(blackout.seasonId, input.seasonId));
  const wanted = generateSlots(
    windows.map((w) => ({
      fieldId: w.fieldId,
      startsAt: w.startsAt.toISOString(),
      endsAt: w.endsAt.toISOString(),
    })),
    blackouts.map((b) =>
      b.fieldId === null
        ? { date: b.onDate }
        : { date: b.onDate, fieldId: b.fieldId },
    ),
    { slotMinutes: input.slotMinutes, timeZone: input.timeZone },
  );
  const windowOf = (fieldId: string, startsAt: string) =>
    windows.find(
      (w) =>
        w.fieldId === fieldId &&
        w.startsAt.toISOString() <= startsAt &&
        startsAt < w.endsAt.toISOString(),
    )?.id ?? null;

  const existing = await db
    .select({
      id: slot.id,
      fieldId: slot.fieldId,
      startsAt: slot.startsAt,
      permitWindowId: slot.permitWindowId,
      status: slot.status,
    })
    .from(slot)
    .where(eq(slot.seasonId, input.seasonId));
  const key = (fieldId: string, startsAt: string) => `${fieldId}@${startsAt}`;
  const byKey = new Map(
    existing.map((s) => [key(s.fieldId, s.startsAt.toISOString()), s]),
  );

  const refreshed: {
    id: SlotId;
    endsAt: string;
    timeIndex: number;
    permitWindowId: PermitWindowId | null;
  }[] = [];
  const fresh = [];
  const matched = new Set<string>();
  for (const s of wanted) {
    const permitWindowId = windowOf(s.fieldId, s.startsAt);
    const old = byKey.get(key(s.fieldId, s.startsAt));
    if (old) {
      matched.add(old.id);
      refreshed.push({
        id: old.id,
        endsAt: s.endsAt,
        timeIndex: s.timeIndex,
        permitWindowId,
      });
    } else
      fresh.push({
        seasonId: input.seasonId,
        fieldId: s.fieldId as FieldId,
        permitWindowId,
        startsAt: new Date(s.startsAt),
        endsAt: new Date(s.endsAt),
        timeIndex: s.timeIndex,
        createdBy: actorId,
      });
  }
  // One statement for every kept slot, not a round trip each.
  if (refreshed.length > 0)
    await db.execute(sql`
      update slot set
        ends_at = v.ends_at,
        time_index = v.time_index,
        permit_window_id = v.permit_window_id,
        updated_at = now()
      from (values ${sql.join(
        refreshed.map(
          (r) =>
            sql`(${r.id}::uuid, ${r.endsAt}::timestamptz, ${r.timeIndex}::int, ${r.permitWindowId}::uuid)`,
        ),
        sql`, `,
      )}) as v(id, ends_at, time_index, permit_window_id)
      where slot.id = v.id`);
  if (fresh.length > 0) await db.insert(slot).values(fresh);

  const stale = existing
    .filter((s) => s.permitWindowId !== null && !matched.has(s.id))
    .map((s) => s.id);
  let retired: SlotId[] = [];
  if (stale.length > 0) {
    const inGames = await db
      .select({ id: game.slotId })
      .from(game)
      .where(and(inArray(game.slotId, stale), isNotNull(game.slotId)));
    const inVersions = await db
      .select({ id: gamePlacement.slotId })
      .from(gamePlacement)
      .where(inArray(gamePlacement.slotId, stale));
    const used = new Set(
      [...inGames, ...inVersions].map((r) => r.id as SlotId),
    );
    retired = stale.filter((id) => used.has(id));
    const unused = stale.filter((id) => !used.has(id));
    if (retired.length > 0)
      await db
        .update(slot)
        .set({ status: "cancelled" })
        .where(inArray(slot.id, retired));
    if (unused.length > 0)
      await db.delete(slot).where(inArray(slot.id, unused));
  }
  const result: SlotSync = {
    added: fresh.length,
    kept: refreshed.length,
    removed: stale.length - retired.length,
    retired: retired.length,
  };
  await recordAudit(db, {
    actorId,
    action: "slots.sync",
    entityType: "season",
    entityId: input.seasonId,
    after: { slotMinutes: input.slotMinutes, ...result },
  });
  return ok(result);
}
