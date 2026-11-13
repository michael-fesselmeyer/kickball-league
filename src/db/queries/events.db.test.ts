import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { type EventInput, eventSlug } from "@/domain/events/event";
import type { LeagueId, UserId } from "@/domain/ids";
import { auditLog } from "../schema/audit";
import { user } from "../schema/auth";
import { event, eventRsvp } from "../schema/event";
import { league } from "../schema/league";
import { message } from "../schema/message";
import { season } from "../schema/season";
import { closePool, inRolledBackDb } from "../test/transaction";
import { deleteAccount } from "./account";
import {
  cancelEvent,
  createEvent,
  deleteEvent,
  eventAttendees,
  eventBySlug,
  joinEvent,
  leagueEvents,
  leaveEvent,
  myEventRsvp,
  myEventRsvps,
  publicEventSlugs,
  seasonOn,
  themeWeeks,
  updateEvent,
} from "./events";
import type { Db } from "./schedule";

afterAll(closePool);

const NY = "America/New_York";
const NOW = new Date("2027-03-01T17:00:00Z");

const bbq: EventInput = {
  kind: "bbq",
  title: "Spring kickoff BBQ",
  place: "McCarren Park, north picnic area",
  description: "Burgers and lawn games.",
  startsAt: new Date("2027-04-10T16:00:00Z"),
  endsAt: new Date("2027-04-10T20:00:00Z"),
  capacity: 2,
};

const costumeWeek: EventInput = {
  kind: "theme_week",
  title: "Costume week",
  place: null,
  description: "",
  startsAt: new Date("2027-04-26T04:00:00Z"),
  endsAt: new Date("2027-05-03T04:00:00Z"),
  capacity: null,
};

/** An invented league with an admin and four players. */
async function world(db: Db) {
  const tag = Math.random().toString(36).slice(2, 8);
  const [lg] = await db
    .insert(league)
    .values({ name: "Event League", slug: `events-${tag}`, timezone: NY })
    .returning({ id: league.id });
  if (!lg) throw new Error("no league");
  const people = await db
    .insert(user)
    .values(
      ["Admin", "Ana", "Ben", "Cy", "Di"].map((name, i) => ({
        name: `${name} Example`,
        email: `events-${i}-${tag}@example.test`,
      })),
    )
    .returning({ id: user.id });
  const [admin, ana, ben, cy, di] = people.map((p) => p.id) as [
    UserId,
    UserId,
    UserId,
    UserId,
    UserId,
  ];
  const create = (input: EventInput) =>
    createEvent(db, {
      leagueId: lg.id,
      timeZone: NY,
      event: input,
      actorId: admin,
    });
  return { tag, leagueId: lg.id, admin, ana, ben, cy, di, create };
}

const join = (db: Db, eventId: string, userId: UserId, now = NOW) =>
  joinEvent(db, { eventId: eventId as never, userId, now });
const leave = (db: Db, eventId: string, userId: UserId, now = NOW) =>
  leaveEvent(db, { eventId: eventId as never, userId, now });

/** Messages queued for a person, by template and payload kind. */
async function notices(db: Db, userId: UserId) {
  const rows = await db
    .select({ template: message.template, payload: message.payload })
    .from(message)
    .where(eq(message.userId, userId));
  return rows.map((r) => `${r.template}:${String(r.payload.kind)}`);
}

describe("createEvent", () => {
  it("saves the event with a slug from its title and date, and an audit row", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      // A title no other test or seed uses, so the slug is free.
      const named = { ...bbq, title: `Spring kickoff BBQ ${w.tag}` };
      const created = await w.create(named);
      const slug = eventSlug(named.title, named.startsAt, NY);
      expect(created.slug).toBe(slug);
      // A second event with the same name on the same day gets its own slug.
      expect((await w.create(named)).slug).toBe(`${slug}-2`);

      const found = await eventBySlug(db, slug);
      expect(found).toMatchObject({
        title: named.title,
        capacity: 2,
        going: 0,
        waitlisted: 0,
        timeZone: NY,
      });
      const [audit] = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.entityId, created.id));
      expect(audit?.action).toBe("event.create");
    });
  });
});

describe("joining and leaving", () => {
  it("gives spots until the event is full, then lines people up", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const { id, slug } = await w.create(bbq);
      expect(await join(db, id, w.ana)).toEqual({
        ok: true,
        value: { status: "going", position: null },
      });
      expect((await join(db, id, w.ben)).ok).toBe(true);
      expect(await join(db, id, w.cy)).toEqual({
        ok: true,
        value: { status: "waitlisted", position: 1 },
      });
      expect(await join(db, id, w.di)).toEqual({
        ok: true,
        value: { status: "waitlisted", position: 2 },
      });
      // Saying yes twice changes nothing.
      expect(await join(db, id, w.cy)).toEqual({
        ok: true,
        value: { status: "waitlisted", position: 1 },
      });

      expect(await eventBySlug(db, slug)).toMatchObject({
        going: 2,
        waitlisted: 2,
      });
      expect(
        (await eventAttendees(db, id)).map((a) => [a.name, a.status]),
      ).toEqual([
        ["Ana Example", "going"],
        ["Ben Example", "going"],
        ["Cy Example", "waitlisted"],
        ["Di Example", "waitlisted"],
      ]);
      expect(await myEventRsvps(db, w.di, [id] as never)).toEqual(
        new Map([[id, "waitlisted"]]),
      );
    });
  });

  it("moves the first person in line up when someone with a spot drops out, and emails them", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const { id } = await w.create(bbq);
      for (const person of [w.ana, w.ben, w.cy, w.di])
        await join(db, id, person);

      expect(await leave(db, id, w.ana)).toEqual({
        ok: true,
        value: { promoted: [w.cy] },
      });
      expect(await myEventRsvp(db, id as never, w.cy)).toEqual({
        status: "going",
        position: null,
      });
      expect(await myEventRsvp(db, id as never, w.di)).toEqual({
        status: "waitlisted",
        position: 1,
      });
      expect(await myEventRsvp(db, id as never, w.ana)).toBeNull();
      expect(await notices(db, w.cy)).toEqual(["event_notice:spot_opened"]);
      expect(await notices(db, w.di)).toEqual([]);

      // Leaving the waitlist moves nobody.
      expect(await leave(db, id, w.di)).toEqual({
        ok: true,
        value: { promoted: [] },
      });
    });
  });

  it("keeps the spot for the line, not a newcomer", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const { id } = await w.create({ ...bbq, capacity: 1 });
      await join(db, id, w.ana);
      await join(db, id, w.ben);
      await leave(db, id, w.ana);
      // Ben moved up when Ana left, so Cy waits.
      expect(
        (await join(db, id, w.cy)).ok &&
          (await myEventRsvp(db, id as never, w.cy)),
      ).toEqual({
        status: "waitlisted",
        position: 1,
      });
    });
  });

  it("is open until the event ends, never for a called-off event or a theme week", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const { id } = await w.create(bbq);
      expect(await join(db, id, w.ana, bbq.endsAt)).toEqual({
        ok: false,
        error: "over",
      });
      const week = await w.create(costumeWeek);
      expect(await join(db, week.id, w.ana)).toEqual({
        ok: false,
        error: "no_rsvp",
      });
      await cancelEvent(db, { id: id as never, actorId: w.admin, now: NOW });
      expect(await join(db, id, w.ana)).toEqual({
        ok: false,
        error: "cancelled",
      });
      await deleteEvent(db, { id: week.id, actorId: w.admin, now: NOW });
      expect(await join(db, week.id, w.ana)).toEqual({
        ok: false,
        error: "not_found",
      });
    });
  });
});

describe("updateEvent", () => {
  it("moves people up when the admin adds spots, and never bumps anyone when they take some away", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const { id, slug } = await w.create(bbq);
      for (const person of [w.ana, w.ben, w.cy, w.di])
        await join(db, id, person);

      const smaller = await updateEvent(db, {
        id: id as never,
        event: { ...bbq, capacity: 1 },
        actorId: w.admin,
      });
      expect(smaller).toEqual({ ok: true, value: { promoted: [] } });
      expect(await eventBySlug(db, slug)).toMatchObject({
        capacity: 1,
        going: 2,
        waitlisted: 2,
      });

      const bigger = await updateEvent(db, {
        id: id as never,
        event: { ...bbq, capacity: 3 },
        actorId: w.admin,
      });
      // Still over 1 → 3 leaves one open spot for Cy.
      expect(bigger).toEqual({ ok: true, value: { promoted: [w.cy] } });

      const unlimited = await updateEvent(db, {
        id: id as never,
        event: { ...bbq, capacity: null },
        actorId: w.admin,
      });
      expect(unlimited).toEqual({ ok: true, value: { promoted: [w.di] } });
      expect(await notices(db, w.di)).toEqual(["event_notice:spot_opened"]);

      const audits = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(
          and(eq(auditLog.entityId, id), eq(auditLog.action, "event.update")),
        );
      expect(audits).toHaveLength(3);
    });
  });

  it("won't turn an event people RSVP'd to into a theme week", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const { id } = await w.create(bbq);
      await join(db, id, w.ana);
      expect(
        await updateEvent(db, {
          id: id as never,
          event: costumeWeek,
          actorId: w.admin,
        }),
      ).toEqual({ ok: false, error: "has_rsvps" });
    });
  });
});

describe("cancelEvent", () => {
  it("keeps the page, clears every RSVP and tells everyone who had one", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const { id, slug } = await w.create(bbq);
      for (const person of [w.ana, w.ben, w.cy]) await join(db, id, person);
      expect(
        await cancelEvent(db, { id: id as never, actorId: w.admin, now: NOW }),
      ).toEqual({ ok: true, value: { notified: 3 } });
      expect(await eventBySlug(db, slug)).toMatchObject({
        cancelledAt: NOW,
        going: 0,
        waitlisted: 0,
      });
      expect(await notices(db, w.cy)).toEqual(["event_notice:cancelled"]);
      expect(
        await cancelEvent(db, { id: id as never, actorId: w.admin, now: NOW }),
      ).toEqual({ ok: false, error: "already" });
    });
  });

  it("tells no one about an event that is already over", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const { id } = await w.create(bbq);
      await join(db, id, w.ana);
      expect(
        await cancelEvent(db, {
          id: id as never,
          actorId: w.admin,
          now: bbq.endsAt,
        }),
      ).toEqual({ ok: true, value: { notified: 0 } });
    });
  });
});

describe("lists", () => {
  it("leave deleted events out everywhere and list theme weeks by game day", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const party = await w.create(bbq);
      const week = await w.create(costumeWeek);
      const gone = await w.create({ ...bbq, title: "Typo" });
      await deleteEvent(db, { id: gone.id, actorId: w.admin, now: NOW });

      expect((await leagueEvents(db, w.leagueId)).map((e) => e.slug)).toEqual([
        party.slug,
        week.slug,
      ]);
      expect(await eventBySlug(db, gone.slug)).toBeNull();
      const slugs = (await publicEventSlugs(db)).map((e) => e.slug);
      expect(slugs).toContain(party.slug);
      expect(slugs).not.toContain(gone.slug);

      expect(await themeWeeks(db, w.leagueId, NY)).toEqual([
        {
          title: "Costume week",
          slug: week.slug,
          first: "2027-04-26",
          last: "2027-05-02",
        },
      ]);
      // A called-off theme week no longer marks the schedule.
      await cancelEvent(db, { id: week.id, actorId: w.admin, now: NOW });
      expect(await themeWeeks(db, w.leagueId, NY)).toEqual([]);
    });
  });

  it("finds the public season a theme week falls in", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await db.insert(season).values({
        leagueId: w.leagueId as LeagueId,
        name: "Spring 2027",
        slug: `spring-${w.tag}`,
        status: "in_progress",
        startsOn: "2027-04-05",
        endsOn: "2027-06-28",
        feeModel: "per_player",
        playerFeeCents: 4500,
        freeAgentFeeCents: 4500,
        rosterMin: 1,
        rosterMax: 20,
      });
      expect(await seasonOn(db, w.leagueId, "2027-04-26")).toEqual({
        slug: `spring-${w.tag}`,
        name: "Spring 2027",
      });
      expect(await seasonOn(db, w.leagueId, "2027-07-01")).toBeNull();
    });
  });
});

describe("deleting an account", () => {
  it("gives up the person's spots, so the waitlist moves up", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const { id } = await w.create({ ...bbq, capacity: 1 });
      await join(db, id, w.ana);
      await join(db, id, w.ben);
      expect((await deleteAccount(db, w.ana, NOW)).ok).toBe(true);
      expect(await myEventRsvp(db, id as never, w.ben)).toEqual({
        status: "going",
        position: null,
      });
      const left = await db
        .select({ id: eventRsvp.id })
        .from(eventRsvp)
        .where(eq(eventRsvp.userId, w.ana));
      expect(left).toEqual([]);
      expect(
        (await db.select().from(event).where(eq(event.id, id))).length,
      ).toBe(1);
    });
  });
});
