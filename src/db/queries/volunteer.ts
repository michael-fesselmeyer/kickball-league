import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  ne,
  sql,
} from "drizzle-orm";
import { whenLine } from "@/domain/events/event";
import type {
  EventId,
  LeagueId,
  SeasonId,
  UserId,
  VolunteerShiftId,
} from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import { addDays } from "@/domain/season/rollover";
import { zonedInstant } from "@/domain/time/zoned";
import {
  type ClaimRefusal,
  mayClaim,
  mayDrop,
  type Occasion,
  ROLE_LABELS,
  type ShiftInput,
  type VolunteerRole,
} from "@/domain/volunteer/shifts";
import { user } from "../schema/auth";
import { event } from "../schema/event";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { volunteerShift, volunteerSignup } from "../schema/volunteer";
import { recordAudit } from "./audit";
import { enqueueMessages } from "./outbox";
import type { Db } from "./schedule";

/**
 * Volunteer shifts (src/domain/volunteer/shifts.ts): what admins post,
 * what members claim and drop, and the reminder the day before. A claim
 * locks the shift's row, so concurrent claims for the last spot queue up
 * and only the first gets it.
 */

export type ShiftRow = ShiftInput & {
  id: VolunteerShiftId;
  /** The season's name or the event's title. */
  occasionName: string;
  /** For an event shift, the event's slug for a link. */
  eventSlug: string | null;
  taken: number;
};

const occasionName = sql<string>`coalesce(${event.title}, ${season.name} || ' game day')`;

const taken = sql<number>`(select count(*)::int from ${volunteerSignup} where ${volunteerSignup.shiftId} = ${volunteerShift.id})`;

const shiftColumns = {
  id: volunteerShift.id,
  role: volunteerShift.role,
  seasonId: volunteerShift.seasonId,
  eventId: volunteerShift.eventId,
  startsAt: volunteerShift.startsAt,
  endsAt: volunteerShift.endsAt,
  place: volunteerShift.place,
  notes: volunteerShift.notes,
  spots: volunteerShift.spots,
  occasionName,
  eventSlug: event.slug,
  taken,
};

type RawShift = {
  id: VolunteerShiftId;
  role: VolunteerRole;
  seasonId: SeasonId | null;
  eventId: EventId | null;
  startsAt: Date;
  endsAt: Date;
  place: string | null;
  notes: string;
  spots: number;
  occasionName: string;
  eventSlug: string | null;
  taken: number;
};

function toShift(r: RawShift): ShiftRow {
  const occasion: Occasion = r.eventId
    ? { kind: "event", eventId: r.eventId }
    : { kind: "season", seasonId: r.seasonId ?? "" };
  return {
    id: r.id,
    role: r.role,
    occasion,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    place: r.place,
    notes: r.notes,
    spots: r.spots,
    occasionName: r.occasionName,
    eventSlug: r.eventSlug,
    taken: r.taken,
  };
}

/** Shifts on a called-off or removed event are hidden. */
const eventStillOn = and(isNull(event.cancelledAt), isNull(event.deletedAt));

function shiftsFrom(db: Db) {
  return db
    .select(shiftColumns)
    .from(volunteerShift)
    .leftJoin(season, eq(season.id, volunteerShift.seasonId))
    .leftJoin(event, eq(event.id, volunteerShift.eventId));
}

/** Shifts that haven't ended, soonest first, with how many spots are taken. */
export async function upcomingShifts(
  db: Db,
  leagueId: LeagueId,
  now: Date,
): Promise<ShiftRow[]> {
  const rows = await shiftsFrom(db)
    .where(
      and(
        eq(volunteerShift.leagueId, leagueId),
        gt(volunteerShift.endsAt, now),
        sql`(${volunteerShift.eventId} is null or (${eventStillOn}))`,
      ),
    )
    .orderBy(asc(volunteerShift.startsAt), asc(volunteerShift.id));
  return rows.map(toShift);
}

/** The ids of the shifts a member is on, among the given ones. */
export async function myShiftIds(
  db: Db,
  userId: UserId,
  shiftIds: readonly VolunteerShiftId[],
): Promise<Set<VolunteerShiftId>> {
  if (shiftIds.length === 0) return new Set();
  const rows = await db
    .select({ id: volunteerSignup.shiftId })
    .from(volunteerSignup)
    .where(
      and(
        eq(volunteerSignup.userId, userId),
        inArray(volunteerSignup.shiftId, [...shiftIds]),
      ),
    );
  return new Set(rows.map((r) => r.id));
}

/** One shift, for the admin's edit screen. */
export async function shiftById(
  db: Db,
  id: VolunteerShiftId,
): Promise<ShiftRow | null> {
  const [row] = await shiftsFrom(db).where(eq(volunteerShift.id, id));
  return row ? toShift(row) : null;
}

const personName = sql<string>`coalesce(nullif(trim(concat_ws(' ', ${profile.firstName}, ${profile.lastName})), ''), nullif(${user.name}, ''), 'A member')`;

export type Volunteer = { shiftId: VolunteerShiftId; name: string };

/**
 * Who has signed up for the shifts that haven't ended, for admins, in the
 * order they signed up. One query for every shift on the screen.
 */
export async function upcomingVolunteers(
  db: Db,
  leagueId: LeagueId,
  now: Date,
): Promise<Volunteer[]> {
  return db
    .select({ shiftId: volunteerSignup.shiftId, name: personName })
    .from(volunteerSignup)
    .innerJoin(volunteerShift, eq(volunteerShift.id, volunteerSignup.shiftId))
    .innerJoin(user, eq(user.id, volunteerSignup.userId))
    .leftJoin(profile, eq(profile.userId, user.id))
    .where(
      and(
        eq(volunteerShift.leagueId, leagueId),
        gt(volunteerShift.endsAt, now),
      ),
    )
    .orderBy(asc(volunteerSignup.createdAt), asc(volunteerSignup.id));
}

export type OccasionChoice = { value: Occasion; label: string };

/**
 * What a shift can be for: seasons that haven't finished (their game days)
 * and events still to come that aren't called off.
 */
export async function occasionChoices(
  db: Db,
  leagueId: LeagueId,
  now: Date,
): Promise<OccasionChoice[]> {
  const [seasons, events] = await Promise.all([
    db
      .select({ id: season.id, name: season.name })
      .from(season)
      .where(and(eq(season.leagueId, leagueId), ne(season.status, "completed")))
      .orderBy(asc(season.startsOn)),
    db
      .select({ id: event.id, title: event.title })
      .from(event)
      .where(
        and(
          eq(event.leagueId, leagueId),
          gt(event.endsAt, now),
          ne(event.kind, "theme_week"),
          eventStillOn,
        ),
      )
      .orderBy(asc(event.startsAt)),
  ]);
  return [
    ...seasons.map((s) => ({
      value: { kind: "season" as const, seasonId: s.id },
      label: `${s.name} game day`,
    })),
    ...events.map((e) => ({
      value: { kind: "event" as const, eventId: e.id },
      label: e.title,
    })),
  ];
}

const occasionColumns = (o: Occasion) =>
  o.kind === "season"
    ? { seasonId: o.seasonId as SeasonId, eventId: null }
    : { seasonId: null, eventId: o.eventId as EventId };

/** Whether the occasion belongs to the league (and an event is still on). */
async function occasionInLeague(
  db: Db,
  leagueId: LeagueId,
  o: Occasion,
): Promise<boolean> {
  const [found] =
    o.kind === "season"
      ? await db
          .select({ id: season.id })
          .from(season)
          .where(
            and(
              eq(season.id, o.seasonId as SeasonId),
              eq(season.leagueId, leagueId),
            ),
          )
      : await db
          .select({ id: event.id })
          .from(event)
          .where(
            and(
              eq(event.id, o.eventId as EventId),
              eq(event.leagueId, leagueId),
              eventStillOn,
            ),
          );
  return found !== undefined;
}

const auditShape = (s: ShiftInput) => ({
  role: s.role,
  ...occasionColumns(s.occasion),
  startsAt: s.startsAt.toISOString(),
  endsAt: s.endsAt.toISOString(),
  place: s.place,
  notes: s.notes,
  spots: s.spots,
});

/** An admin posts a shift. */
export async function createShift(
  db: Db,
  input: { leagueId: LeagueId; shift: ShiftInput; actorId: UserId },
): Promise<Result<VolunteerShiftId, "occasion">> {
  if (!(await occasionInLeague(db, input.leagueId, input.shift.occasion)))
    return err("occasion");
  const { occasion, ...rest } = input.shift;
  const [created] = await db
    .insert(volunteerShift)
    .values({
      leagueId: input.leagueId,
      ...rest,
      ...occasionColumns(occasion),
      createdBy: input.actorId,
    })
    .returning({ id: volunteerShift.id });
  if (!created) throw new Error("Insert returned no shift");
  await recordAudit(db, {
    actorId: input.actorId,
    action: "volunteer.create",
    entityType: "volunteer_shift",
    entityId: created.id,
    after: auditShape(input.shift),
  });
  return ok(created.id);
}

/**
 * An admin changes a shift. The spots can't drop below the people already
 * signed up: the admin removes the shift or asks someone to drop first.
 */
export async function updateShift(
  db: Db,
  input: {
    id: VolunteerShiftId;
    leagueId: LeagueId;
    shift: ShiftInput;
    actorId: UserId;
  },
): Promise<Result<void, "not_found" | "occasion" | "too_few_spots">> {
  const before = await lockShift(db, input.id);
  if (!before || before.leagueId !== input.leagueId) return err("not_found");
  if (!(await occasionInLeague(db, input.leagueId, input.shift.occasion)))
    return err("occasion");
  const count = await takenCount(db, input.id);
  if (input.shift.spots < count) return err("too_few_spots");
  const { occasion, ...rest } = input.shift;
  await db
    .update(volunteerShift)
    .set({ ...rest, ...occasionColumns(occasion) })
    .where(eq(volunteerShift.id, input.id));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "volunteer.update",
    entityType: "volunteer_shift",
    entityId: input.id,
    before: {
      role: before.role,
      seasonId: before.seasonId,
      eventId: before.eventId,
      startsAt: before.startsAt.toISOString(),
      endsAt: before.endsAt.toISOString(),
      place: before.place,
      notes: before.notes,
      spots: before.spots,
    },
    after: auditShape(input.shift),
  });
  return ok(undefined);
}

/** An admin removes a shift and everyone's spot on it. */
export async function deleteShift(
  db: Db,
  input: { id: VolunteerShiftId; leagueId: LeagueId; actorId: UserId },
): Promise<Result<void, "not_found">> {
  const before = await lockShift(db, input.id);
  if (!before || before.leagueId !== input.leagueId) return err("not_found");
  const count = await takenCount(db, input.id);
  await db.delete(volunteerShift).where(eq(volunteerShift.id, input.id));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "volunteer.delete",
    entityType: "volunteer_shift",
    entityId: input.id,
    before: {
      role: before.role,
      startsAt: before.startsAt.toISOString(),
      spots: before.spots,
      signedUp: count,
    },
  });
  return ok(undefined);
}

async function lockShift(db: Db, id: VolunteerShiftId) {
  const [found] = await db
    .select()
    .from(volunteerShift)
    .where(eq(volunteerShift.id, id))
    .for("update");
  return found;
}

async function takenCount(db: Db, id: VolunteerShiftId): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(volunteerSignup)
    .where(eq(volunteerSignup.shiftId, id));
  return row?.n ?? 0;
}

/**
 * A member takes a spot. The shift's row is locked first, so a second
 * claim for the last spot waits, then counts the first one and is refused.
 * Run it inside a transaction.
 */
export async function claimShift(
  db: Db,
  input: {
    shiftId: VolunteerShiftId;
    leagueId: LeagueId;
    userId: UserId;
    now: Date;
  },
): Promise<Result<void, ClaimRefusal | "not_found">> {
  const shift = await lockShift(db, input.shiftId);
  if (!shift || shift.leagueId !== input.leagueId) return err("not_found");
  if (shift.eventId) {
    const [on] = await db
      .select({ id: event.id })
      .from(event)
      .where(and(eq(event.id, shift.eventId), eventStillOn));
    if (!on) return err("not_found");
  }
  const [mine] = await db
    .select({ id: volunteerSignup.id })
    .from(volunteerSignup)
    .where(
      and(
        eq(volunteerSignup.shiftId, input.shiftId),
        eq(volunteerSignup.userId, input.userId),
      ),
    );
  const allowed = mayClaim({
    startsAt: shift.startsAt,
    spots: shift.spots,
    taken: await takenCount(db, input.shiftId),
    alreadyOn: mine !== undefined,
    now: input.now,
  });
  if (!allowed.ok) return allowed;
  await db
    .insert(volunteerSignup)
    .values({
      shiftId: input.shiftId,
      userId: input.userId,
      createdAt: input.now,
    })
    .onConflictDoNothing({
      target: [volunteerSignup.shiftId, volunteerSignup.userId],
    });
  return ok(undefined);
}

/** A member gives their spot back, before the shift starts. */
export async function dropShift(
  db: Db,
  input: { shiftId: VolunteerShiftId; userId: UserId; now: Date },
): Promise<Result<void, "started" | "not_on">> {
  const shift = await lockShift(db, input.shiftId);
  if (!shift) return err("not_on");
  const allowed = mayDrop({ startsAt: shift.startsAt, now: input.now });
  if (!allowed.ok) return allowed;
  const removed = await db
    .delete(volunteerSignup)
    .where(
      and(
        eq(volunteerSignup.shiftId, input.shiftId),
        eq(volunteerSignup.userId, input.userId),
      ),
    )
    .returning({ id: volunteerSignup.id });
  return removed.length > 0 ? ok(undefined) : err("not_on");
}

/** A member's own shifts, for their data export. */
export async function myVolunteerShifts(db: Db, userId: UserId) {
  return db
    .select({
      role: volunteerShift.role,
      occasion: occasionName,
      startsAt: volunteerShift.startsAt,
      endsAt: volunteerShift.endsAt,
      signedUpAt: volunteerSignup.createdAt,
    })
    .from(volunteerSignup)
    .innerJoin(volunteerShift, eq(volunteerShift.id, volunteerSignup.shiftId))
    .leftJoin(season, eq(season.id, volunteerShift.seasonId))
    .leftJoin(event, eq(event.id, volunteerShift.eventId))
    .where(eq(volunteerSignup.userId, userId))
    .orderBy(asc(volunteerShift.startsAt));
}

/**
 * Queues one reminder per volunteer for every shift that starts tomorrow
 * in the league's time zone. Safe to run twice: the dedupe key names the
 * shift and the person. Returns how many were new.
 */
export async function queueVolunteerReminders(
  db: Db,
  input: { leagueId: LeagueId; today: string; timeZone: string },
): Promise<number> {
  const tomorrow = addDays(input.today, 1);
  const from = zonedInstant(tomorrow, "00:00", input.timeZone);
  const to = zonedInstant(addDays(tomorrow, 1), "00:00", input.timeZone);
  const rows = await db
    .select({
      shiftId: volunteerShift.id,
      userId: volunteerSignup.userId,
      role: volunteerShift.role,
      occasion: occasionName,
      startsAt: volunteerShift.startsAt,
      endsAt: volunteerShift.endsAt,
      place: volunteerShift.place,
      notes: volunteerShift.notes,
    })
    .from(volunteerSignup)
    .innerJoin(volunteerShift, eq(volunteerShift.id, volunteerSignup.shiftId))
    .leftJoin(season, eq(season.id, volunteerShift.seasonId))
    .leftJoin(event, eq(event.id, volunteerShift.eventId))
    .where(
      and(
        eq(volunteerShift.leagueId, input.leagueId),
        gte(volunteerShift.startsAt, from),
        lt(volunteerShift.startsAt, to),
        sql`(${volunteerShift.eventId} is null or (${eventStillOn}))`,
      ),
    );
  if (rows.length === 0) return 0;
  return enqueueMessages(
    db,
    rows.map((r) => ({
      userId: r.userId,
      template: "volunteer_reminder" as const,
      topic: "events" as const,
      payload: {
        role: ROLE_LABELS[r.role],
        occasion: r.occasion,
        when: whenLine(
          { kind: "social", startsAt: r.startsAt, endsAt: r.endsAt },
          input.timeZone,
        ),
        place: r.place,
        notes: r.notes,
      },
      dedupeKey: `volunteer_reminder/${r.shiftId}/${r.userId}`,
    })),
  );
}

/**
 * When a member deletes their account: their spots on shifts that haven't
 * started go back. Spots on past shifts stay, under the anonymized account.
 */
export async function dropFutureShifts(
  db: Db,
  userId: UserId,
  now: Date,
): Promise<void> {
  await db
    .delete(volunteerSignup)
    .where(
      and(
        eq(volunteerSignup.userId, userId),
        inArray(
          volunteerSignup.shiftId,
          db
            .select({ id: volunteerShift.id })
            .from(volunteerShift)
            .where(gt(volunteerShift.startsAt, now)),
        ),
      ),
    );
}
