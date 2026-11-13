import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  sql,
} from "drizzle-orm";
import type { Audience, Reach } from "@/domain/events/audience";
import {
  type EventInput,
  type EventKind,
  eventSlug,
  placeFor,
  promotions,
  type RsvpStatus,
  rsvpWindow,
  type ThemeWeek,
  themeWeekDays,
  whenLine,
} from "@/domain/events/event";
import type { EventId, LeagueId, SeasonId, TeamId, UserId } from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import type { EventNoticePayload } from "@/emails/event";
import { user } from "../schema/auth";
import { event, eventAudienceTeam, eventRsvp } from "../schema/event";
import { league } from "../schema/league";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { recordAudit } from "./audit";
import { enqueueMessages, type OutboxMessage } from "./outbox";
import type { Db } from "./schedule";

/** League events and their RSVPs (docs/data-model.md, section 2.5). */

export type EventSummary = {
  id: EventId;
  slug: string;
  kind: EventKind;
  title: string;
  place: string | null;
  description: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number | null;
  cancelledAt: Date | null;
  updatedAt: Date;
  going: number;
  waitlisted: number;
  audience: Audience;
  inviteUrl: string | null;
  inAppRsvp: boolean;
};

const going = sql<number>`(count(${eventRsvp.id}) filter (where ${eventRsvp.status} = 'going'))::int`;
const waitlisted = sql<number>`(count(${eventRsvp.id}) filter (where ${eventRsvp.status} = 'waitlisted'))::int`;

/** The teams of a teams audience, read with the event in the same query. */
export const audienceTeamIds = sql<
  TeamId[]
>`coalesce((select array_agg(${eventAudienceTeam.teamId}::text order by ${eventAudienceTeam.teamId}) from ${eventAudienceTeam} where ${eventAudienceTeam.eventId} = ${event.id}), '{}')`;

const summaryColumns = {
  id: event.id,
  slug: event.slug,
  kind: event.kind,
  title: event.title,
  place: event.place,
  description: event.description,
  startsAt: event.startsAt,
  endsAt: event.endsAt,
  capacity: event.capacity,
  cancelledAt: event.cancelledAt,
  updatedAt: event.updatedAt,
  going,
  waitlisted,
  audienceKind: event.audience,
  audienceSeasonId: event.audienceSeasonId,
  audienceTeamIds,
  inviteUrl: event.inviteUrl,
  inAppRsvp: event.inAppRsvp,
};

/** A stored audience as the domain's. */
export function audienceFrom(row: {
  audienceKind: "public" | "members" | "teams";
  audienceSeasonId: SeasonId | null;
  audienceTeamIds: readonly TeamId[];
}): Audience {
  if (row.audienceKind !== "teams") return { kind: row.audienceKind };
  return {
    kind: "teams",
    seasonId: row.audienceSeasonId,
    teamIds: row.audienceTeamIds,
  };
}

function toSummary<
  Row extends {
    audienceKind: "public" | "members" | "teams";
    audienceSeasonId: SeasonId | null;
    audienceTeamIds: readonly TeamId[];
  },
>({
  audienceKind,
  audienceSeasonId,
  audienceTeamIds,
  ...rest
}: Row): Omit<Row, "audienceKind" | "audienceSeasonId" | "audienceTeamIds"> & {
  audience: Audience;
} {
  return {
    ...rest,
    audience: audienceFrom({ audienceKind, audienceSeasonId, audienceTeamIds }),
  };
}

export type EventVisibility = "public" | "all";

const visibility = (only: EventVisibility) =>
  only === "public" ? eq(event.audience, "public") : undefined;

/**
 * A league's events that aren't deleted, soonest first, with RSVP counts and
 * audiences, in one query. Public pages and the public feed ask for the
 * public ones only; the signed-in app filters the rest per viewer.
 */
export async function leagueEvents(
  db: Db,
  leagueId: LeagueId,
  only: EventVisibility,
): Promise<EventSummary[]> {
  const rows = await db
    .select(summaryColumns)
    .from(event)
    .leftJoin(eventRsvp, eq(eventRsvp.eventId, event.id))
    .where(
      and(
        eq(event.leagueId, leagueId),
        isNull(event.deletedAt),
        visibility(only),
      ),
    )
    .groupBy(event.id)
    .orderBy(asc(event.startsAt), asc(event.title));
  return rows.map(toSummary);
}

export type EventDetails = EventSummary & {
  leagueId: LeagueId;
  timeZone: string;
};

/**
 * One event by its slug, with counts and the league's time zone. Public
 * pages ask for public events only, so a members' event has no public page.
 */
export async function eventBySlug(
  db: Db,
  slug: string,
  only: EventVisibility,
): Promise<EventDetails | null> {
  const [found] = await db
    .select({
      ...summaryColumns,
      leagueId: event.leagueId,
      timeZone: league.timezone,
    })
    .from(event)
    .innerJoin(league, eq(league.id, event.leagueId))
    .leftJoin(eventRsvp, eq(eventRsvp.eventId, event.id))
    .where(and(eq(event.slug, slug), isNull(event.deletedAt), visibility(only)))
    .groupBy(event.id, league.timezone);
  return found ? toSummary(found) : null;
}

/**
 * Slugs of every event with a public page, for prerendering and the
 * sitemap. Members' and team events have none.
 */
export async function publicEventSlugs(db: Db) {
  return db
    .select({ slug: event.slug, updatedAt: event.updatedAt })
    .from(event)
    .where(and(isNull(event.deletedAt), eq(event.audience, "public")))
    .orderBy(asc(event.startsAt));
}

/**
 * A league's theme weeks as game-day ranges, for the public schedule.
 * Called-off weeks are left out.
 */
export async function themeWeeks(
  db: Db,
  leagueId: LeagueId,
  timeZone: string,
): Promise<ThemeWeek[]> {
  const rows = await db
    .select({
      title: event.title,
      slug: event.slug,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
    })
    .from(event)
    .where(
      and(
        eq(event.leagueId, leagueId),
        eq(event.kind, "theme_week"),
        // Always public (a check constraint), but say so where it matters.
        eq(event.audience, "public"),
        isNull(event.deletedAt),
        isNull(event.cancelledAt),
      ),
    )
    .orderBy(asc(event.startsAt));
  return rows.map((r) => ({
    title: r.title,
    slug: r.slug,
    ...themeWeekDays(r, timeZone),
  }));
}

/** A slug no other event has: the base, then -2, -3 and so on. */
async function freeSlug(db: Db, base: string): Promise<string> {
  const taken = new Set(
    (
      await db
        .select({ slug: event.slug })
        .from(event)
        .where(
          sql`${event.slug} = ${base} or ${event.slug} like ${`${base}-%`}`,
        )
    ).map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1)
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** Who an event is for and how people RSVP, as its columns. */
function reachColumns(reach: Reach) {
  return {
    audience: reach.audience.kind,
    audienceSeasonId:
      reach.audience.kind === "teams" ? reach.audience.seasonId : null,
    inviteUrl: reach.inviteUrl,
    inAppRsvp: reach.inAppRsvp,
  };
}

/** Replaces the teams an event is for. */
async function saveAudienceTeams(db: Db, eventId: EventId, audience: Audience) {
  await db
    .delete(eventAudienceTeam)
    .where(eq(eventAudienceTeam.eventId, eventId));
  if (audience.kind === "teams" && audience.teamIds.length > 0)
    await db
      .insert(eventAudienceTeam)
      .values(audience.teamIds.map((teamId) => ({ eventId, teamId })));
}

/** A reach for the audit log. */
const reachAudit = (reach: Reach) => ({
  audience: reach.audience,
  inviteUrl: reach.inviteUrl,
  inAppRsvp: reach.inAppRsvp,
});

/** Saves a new event and its audit row. Run it in a transaction. */
export async function createEvent(
  db: Db,
  input: {
    leagueId: LeagueId;
    timeZone: string;
    event: EventInput;
    reach: Reach;
    actorId: UserId;
  },
): Promise<{ id: EventId; slug: string }> {
  const slug = await freeSlug(
    db,
    eventSlug(input.event.title, input.event.startsAt, input.timeZone),
  );
  const [created] = await db
    .insert(event)
    .values({
      ...input.event,
      ...reachColumns(input.reach),
      leagueId: input.leagueId,
      slug,
      createdBy: input.actorId,
    })
    .returning({ id: event.id, slug: event.slug });
  if (!created) throw new Error("The event was not saved");
  await saveAudienceTeams(db, created.id, input.reach.audience);
  await recordAudit(db, {
    actorId: input.actorId,
    action: "event.create",
    entityType: "event",
    entityId: created.id,
    after: { ...input.event, ...reachAudit(input.reach), slug },
  });
  return created;
}

type Locked = {
  id: EventId;
  slug: string;
  kind: EventKind;
  title: string;
  place: string | null;
  startsAt: Date;
  endsAt: Date;
  capacity: number | null;
  cancelledAt: Date | null;
  inAppRsvp: boolean;
  timeZone: string;
};

/**
 * The event, locked until the transaction ends, so two RSVPs for the last
 * spot are taken one after the other.
 */
async function lockEvent(db: Db, id: EventId): Promise<Locked | null> {
  const [found] = await db
    .select({
      id: event.id,
      slug: event.slug,
      kind: event.kind,
      title: event.title,
      place: event.place,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      capacity: event.capacity,
      cancelledAt: event.cancelledAt,
      inAppRsvp: event.inAppRsvp,
      timeZone: league.timezone,
    })
    .from(event)
    .innerJoin(league, eq(league.id, event.leagueId))
    .where(and(eq(event.id, id), isNull(event.deletedAt)))
    .for("update", { of: event });
  return found ?? null;
}

async function counts(db: Db, eventId: EventId) {
  const [row] = await db
    .select({ going, waitlisted })
    .from(eventRsvp)
    .where(eq(eventRsvp.eventId, eventId));
  return { going: row?.going ?? 0, waitlisted: row?.waitlisted ?? 0 };
}

function notice(
  e: Locked,
  userId: UserId,
  kind: EventNoticePayload["kind"],
  dedupeKey: string,
): OutboxMessage {
  const payload: EventNoticePayload = {
    kind,
    title: e.title,
    slug: e.slug,
    when: whenLine(e, e.timeZone),
    place: e.place,
  };
  return {
    userId,
    topic: "events",
    template: "event_notice",
    payload,
    dedupeKey,
  };
}

/**
 * Moves the earliest waitlisted people into any open spots and emails each
 * of them. Call it with the event locked. Returns who moved up.
 */
async function fillFromWaitlist(db: Db, e: Locked): Promise<UserId[]> {
  const now = await counts(db, e.id);
  const n = promotions(e.capacity, now.going, now.waitlisted);
  if (n === 0) return [];
  const next = await db
    .select({ id: eventRsvp.id, userId: eventRsvp.userId })
    .from(eventRsvp)
    .where(and(eq(eventRsvp.eventId, e.id), eq(eventRsvp.status, "waitlisted")))
    .orderBy(asc(eventRsvp.createdAt), asc(eventRsvp.id))
    .limit(n);
  if (next.length === 0) return [];
  await db
    .update(eventRsvp)
    .set({ status: "going" })
    .where(
      inArray(
        eventRsvp.id,
        next.map((r) => r.id),
      ),
    );
  await enqueueMessages(
    db,
    next.map((r) => notice(e, r.userId, "spot_opened", `event_spot/${r.id}`)),
  );
  return next.map((r) => r.userId);
}

export type EventChangeError = "not_found" | "has_rsvps" | "rsvps_in_app";

/**
 * Saves an admin's edit and its audit row. Run it in a transaction. A larger
 * capacity moves people up from the waitlist; a smaller one never takes a
 * spot from anyone who has it. An event people RSVP'd to can't become a
 * theme week, which has nothing to RSVP to, or stop taking RSVPs in the app.
 */
export async function updateEvent(
  db: Db,
  input: { id: EventId; event: EventInput; reach: Reach; actorId: UserId },
): Promise<Result<{ promoted: UserId[] }, EventChangeError>> {
  const before = await lockEvent(db, input.id);
  if (!before) return err("not_found");
  const now = await counts(db, input.id);
  const rsvps = now.going + now.waitlisted;
  if (input.event.kind === "theme_week" && rsvps > 0) return err("has_rsvps");
  if (!input.reach.inAppRsvp && rsvps > 0) return err("rsvps_in_app");
  await db
    .update(event)
    .set({ ...input.event, ...reachColumns(input.reach) })
    .where(eq(event.id, input.id));
  await saveAudienceTeams(db, input.id, input.reach.audience);
  await recordAudit(db, {
    actorId: input.actorId,
    action: "event.update",
    entityType: "event",
    entityId: input.id,
    before: {
      kind: before.kind,
      title: before.title,
      place: before.place,
      startsAt: before.startsAt,
      endsAt: before.endsAt,
      capacity: before.capacity,
      inAppRsvp: before.inAppRsvp,
    },
    after: { ...input.event, ...reachAudit(input.reach) },
  });
  const promoted =
    before.cancelledAt === null
      ? await fillFromWaitlist(db, {
          ...before,
          ...input.event,
          inAppRsvp: input.reach.inAppRsvp,
        })
      : [];
  return ok({ promoted });
}

/**
 * Calls an event off: its page stays up and says so, every RSVP is cleared,
 * and everyone who had one hears about it. Run it in a transaction.
 */
export async function cancelEvent(
  db: Db,
  input: { id: EventId; actorId: UserId; now: Date },
): Promise<Result<{ notified: number }, "not_found" | "already">> {
  const e = await lockEvent(db, input.id);
  if (!e) return err("not_found");
  if (e.cancelledAt) return err("already");
  await db
    .update(event)
    .set({ cancelledAt: input.now })
    .where(eq(event.id, input.id));
  const cleared = await db
    .delete(eventRsvp)
    .where(eq(eventRsvp.eventId, input.id))
    .returning({ userId: eventRsvp.userId });
  // No one needs telling about an event that is already over.
  const notified =
    e.endsAt > input.now
      ? await enqueueMessages(
          db,
          cleared.map((r) =>
            notice(
              e,
              r.userId,
              "cancelled",
              `event_cancelled/${e.id}/${r.userId}`,
            ),
          ),
        )
      : 0;
  await recordAudit(db, {
    actorId: input.actorId,
    action: "event.cancel",
    entityType: "event",
    entityId: input.id,
    after: { cancelledAt: input.now, rsvpsCleared: cleared.length },
  });
  return ok({ notified });
}

/** Takes an event off every page. Run it in a transaction. */
export async function deleteEvent(
  db: Db,
  input: { id: EventId; actorId: UserId; now: Date },
): Promise<Result<void, "not_found">> {
  const e = await lockEvent(db, input.id);
  if (!e) return err("not_found");
  await db
    .update(event)
    .set({ deletedAt: input.now })
    .where(eq(event.id, input.id));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "event.delete",
    entityType: "event",
    entityId: input.id,
    before: { title: e.title, slug: e.slug },
  });
  return ok(undefined);
}

export type RsvpError =
  "not_found" | "cancelled" | "over" | "no_rsvp" | "invite_only";

export type MyRsvp = {
  status: RsvpStatus;
  /** Place in line, from 1, while waitlisted. */
  position: number | null;
};

/**
 * RSVPs someone: a spot while there is one, else the end of the waitlist.
 * Saying yes again changes nothing. Run it in a transaction.
 */
export async function joinEvent(
  db: Db,
  input: { eventId: EventId; userId: UserId; now: Date },
): Promise<Result<MyRsvp, RsvpError>> {
  const e = await lockEvent(db, input.eventId);
  if (!e) return err("not_found");
  const window = rsvpWindow(e, input.now);
  if (window !== "open") return err(window);
  const mine = await myEventRsvp(db, input.eventId, input.userId);
  if (mine) return ok(mine);
  const now = await counts(db, input.eventId);
  const status = placeFor(e.capacity, now.going, now.waitlisted);
  await db
    .insert(eventRsvp)
    // The clock, not the transaction start, so the line keeps its order.
    .values({
      eventId: input.eventId,
      userId: input.userId,
      status,
      createdAt: sql`clock_timestamp()`,
    });
  return ok({
    status,
    position: status === "waitlisted" ? now.waitlisted + 1 : null,
  });
}

/**
 * Drops someone's RSVP. If they had a spot, the next person on the waitlist
 * gets it. Run it in a transaction.
 */
export async function leaveEvent(
  db: Db,
  input: { eventId: EventId; userId: UserId; now: Date },
): Promise<Result<{ promoted: UserId[] }, RsvpError>> {
  const e = await lockEvent(db, input.eventId);
  if (!e) return err("not_found");
  const window = rsvpWindow(e, input.now);
  if (window !== "open") return err(window);
  const removed = await db
    .delete(eventRsvp)
    .where(
      and(
        eq(eventRsvp.eventId, input.eventId),
        eq(eventRsvp.userId, input.userId),
      ),
    )
    .returning({ status: eventRsvp.status });
  if (removed[0]?.status !== "going") return ok({ promoted: [] });
  return ok({ promoted: await fillFromWaitlist(db, e) });
}

/** Someone's RSVP for an event, with their place in line if waitlisted. */
export async function myEventRsvp(
  db: Db,
  eventId: EventId,
  userId: UserId,
): Promise<MyRsvp | null> {
  const [mine] = await db
    .select({ status: eventRsvp.status, createdAt: eventRsvp.createdAt })
    .from(eventRsvp)
    .where(and(eq(eventRsvp.eventId, eventId), eq(eventRsvp.userId, userId)));
  if (!mine) return null;
  if (mine.status === "going") return { status: "going", position: null };
  const [ahead] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(eventRsvp)
    .where(
      and(
        eq(eventRsvp.eventId, eventId),
        eq(eventRsvp.status, "waitlisted"),
        lt(eventRsvp.createdAt, mine.createdAt),
      ),
    );
  return { status: "waitlisted", position: (ahead?.n ?? 0) + 1 };
}

/** Someone's RSVPs for the given events. */
export async function myEventRsvps(
  db: Db,
  userId: UserId,
  eventIds: readonly EventId[],
): Promise<Map<EventId, RsvpStatus>> {
  if (eventIds.length === 0) return new Map();
  const rows = await db
    .select({ eventId: eventRsvp.eventId, status: eventRsvp.status })
    .from(eventRsvp)
    .where(
      and(
        eq(eventRsvp.userId, userId),
        inArray(eventRsvp.eventId, [...eventIds]),
      ),
    );
  return new Map(rows.map((r) => [r.eventId, r.status]));
}

export type Attendee = {
  userId: UserId;
  name: string;
  status: RsvpStatus;
  since: Date;
};

/** Who is going and who is waiting, in order, for the admin. */
export async function eventAttendees(
  db: Db,
  eventId: EventId,
): Promise<Attendee[]> {
  const rows = await db
    .select({
      userId: eventRsvp.userId,
      first: profile.firstName,
      last: profile.lastName,
      account: user.name,
      status: eventRsvp.status,
      since: eventRsvp.createdAt,
    })
    .from(eventRsvp)
    .innerJoin(user, eq(user.id, eventRsvp.userId))
    .leftJoin(profile, eq(profile.userId, eventRsvp.userId))
    .where(eq(eventRsvp.eventId, eventId))
    .orderBy(
      sql`${eventRsvp.status} = 'waitlisted'`,
      asc(eventRsvp.createdAt),
      asc(eventRsvp.id),
    );
  return rows.map((r) => ({
    userId: r.userId,
    name: [r.first, r.last].filter(Boolean).join(" ") || r.account,
    status: r.status,
    since: r.since,
  }));
}

/** The public season whose dates cover a day, for a theme week's schedule link. */
export async function seasonOn(
  db: Db,
  leagueId: LeagueId,
  day: string,
): Promise<{ slug: string; name: string } | null> {
  const [found] = await db
    .select({ slug: season.slug, name: season.name })
    .from(season)
    .where(
      and(
        eq(season.leagueId, leagueId),
        ne(season.status, "draft"),
        lte(season.startsOn, day),
        gte(season.endsOn, day),
      ),
    )
    .orderBy(asc(season.startsOn))
    .limit(1);
  return found ?? null;
}
