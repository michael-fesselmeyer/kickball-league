import { and, eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import type { LeagueId, UserId, VolunteerShiftId } from "@/domain/ids";
import type { ShiftInput } from "@/domain/volunteer/shifts";
import * as schema from "../schema";
import { auditLog } from "../schema/audit";
import { user } from "../schema/auth";
import { event } from "../schema/event";
import { league } from "../schema/league";
import { message } from "../schema/message";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { volunteerShift, volunteerSignup } from "../schema/volunteer";
import { closePool, inRolledBackDb } from "../test/transaction";
import { deleteAccount, personalData } from "./account";
import type { Db } from "./schedule";
import {
  claimShift,
  createShift,
  deleteShift,
  dropShift,
  myShiftIds,
  occasionChoices,
  queueVolunteerReminders,
  shiftById,
  upcomingShifts,
  upcomingVolunteers,
  updateShift,
} from "./volunteer";

afterAll(closePool);

const NY = "America/New_York";
// Tuesday, Oct 20 2026, 6:00 to 6:45 PM in New York.
const STARTS = new Date("2026-10-20T22:00:00Z");
const ENDS = new Date("2026-10-20T22:45:00Z");
const BEFORE = new Date("2026-10-18T16:00:00Z");

/** An invented league with a season, an event, an admin and members. */
async function world(db: Db, members = 4) {
  const tag = Math.random().toString(36).slice(2, 8);
  const [lg] = await db
    .insert(league)
    .values({ name: "Volunteer League", slug: `vol-${tag}`, timezone: NY })
    .returning({ id: league.id });
  if (!lg) throw new Error("no league");
  const [fall] = await db
    .insert(season)
    .values({
      leagueId: lg.id,
      name: "Fall Social",
      slug: `vol-fall-${tag}`,
      status: "in_progress",
      startsOn: "2026-09-01",
      endsOn: "2026-11-30",
      feeModel: "per_player",
      playerFeeCents: 4500,
      freeAgentFeeCents: 4500,
      rosterMin: 1,
      rosterMax: 20,
    })
    .returning({ id: season.id });
  if (!fall) throw new Error("no season");
  const [e] = await db
    .insert(event)
    .values({
      leagueId: lg.id,
      kind: "bbq",
      title: "Season BBQ",
      slug: `vol-bbq-${tag}`,
      startsAt: new Date("2026-10-24T16:00:00Z"),
      endsAt: new Date("2026-10-24T20:00:00Z"),
    })
    .returning({ id: event.id });
  if (!e) throw new Error("no event");
  const people = await db
    .insert(user)
    .values(
      Array.from({ length: members + 1 }, (_, i) => ({
        name: i === 0 ? "Ada Admin" : `Member ${i}`,
        email: `vol-${i}-${tag}@example.test`,
      })),
    )
    .returning({ id: user.id });
  const [admin, ...rest] = people.map((p) => p.id);
  if (!admin) throw new Error("no admin");
  await db.insert(profile).values([
    { userId: admin, globalRole: "admin" as const },
    ...rest.map((userId, i) => ({
      userId,
      firstName: "Member",
      lastName: `Number${i + 1}`,
    })),
  ]);
  return {
    leagueId: lg.id,
    seasonId: fall.id,
    eventId: e.id,
    admin,
    members: rest,
  };
}

type World = Awaited<ReturnType<typeof world>>;

const shiftInput = (w: World, over: Partial<ShiftInput> = {}): ShiftInput => ({
  role: "setup",
  occasion: { kind: "season", seasonId: w.seasonId },
  startsAt: STARTS,
  endsAt: ENDS,
  place: "Field 2",
  notes: "",
  spots: 2,
  ...over,
});

async function withShift(db: Db, over: Partial<ShiftInput> = {}) {
  const w = await world(db);
  const created = await createShift(db, {
    leagueId: w.leagueId,
    shift: shiftInput(w, over),
    actorId: w.admin,
  });
  if (!created.ok) throw new Error(created.error);
  return { ...w, shiftId: created.value };
}

describe("posting shifts", () => {
  it("posts a game-day shift and an event shift, audited", () =>
    inRolledBackDb(async (db) => {
      const w = await withShift(db);
      const atEvent = await createShift(db, {
        leagueId: w.leagueId,
        shift: shiftInput(w, {
          role: "check_in",
          occasion: { kind: "event", eventId: w.eventId },
          startsAt: new Date("2026-10-24T15:30:00Z"),
          endsAt: new Date("2026-10-24T17:00:00Z"),
        }),
        actorId: w.admin,
      });
      expect(atEvent.ok).toBe(true);
      const shifts = await upcomingShifts(db, w.leagueId, BEFORE);
      expect(
        shifts.map((s) => [s.role, s.occasionName, s.taken, s.spots]),
      ).toEqual([
        ["setup", "Fall Social game day", 0, 2],
        ["check_in", "Season BBQ", 0, 2],
      ]);
      const audits = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.actorId, w.admin));
      expect(audits.map((a) => a.action)).toEqual([
        "volunteer.create",
        "volunteer.create",
      ]);
    }));

  it("refuses a season from another league", () =>
    inRolledBackDb(async (db) => {
      const a = await world(db);
      const b = await world(db);
      const result = await createShift(db, {
        leagueId: a.leagueId,
        shift: shiftInput(b),
        actorId: a.admin,
      });
      expect(result).toEqual({ ok: false, error: "occasion" });
    }));

  it("offers unfinished seasons and upcoming events, not theme weeks", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const choices = await occasionChoices(db, w.leagueId, BEFORE);
      expect(choices.map((c) => c.label)).toEqual([
        "Fall Social game day",
        "Season BBQ",
      ]);
      await db
        .update(event)
        .set({ cancelledAt: BEFORE })
        .where(eq(event.id, w.eventId));
      await db
        .update(season)
        .set({ status: "completed" })
        .where(eq(season.id, w.seasonId));
      expect(await occasionChoices(db, w.leagueId, BEFORE)).toEqual([]);
    }));

  it("hides shifts at a called-off event", () =>
    inRolledBackDb(async (db) => {
      const w = await withShift(db, {});
      await createShift(db, {
        leagueId: w.leagueId,
        shift: shiftInput(w, {
          occasion: { kind: "event", eventId: w.eventId },
        }),
        actorId: w.admin,
      });
      await db
        .update(event)
        .set({ cancelledAt: BEFORE })
        .where(eq(event.id, w.eventId));
      const shifts = await upcomingShifts(db, w.leagueId, BEFORE);
      expect(shifts.map((s) => s.occasionName)).toEqual([
        "Fall Social game day",
      ]);
    }));

  it("keeps a shift to one occasion and sensible spots", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const base = {
        leagueId: w.leagueId,
        role: "setup" as const,
        startsAt: STARTS,
        endsAt: ENDS,
        spots: 2,
      };
      // Each attempt in its own savepoint, so a refusal doesn't end the test.
      const tryInsert = (row: Partial<typeof volunteerShift.$inferInsert>) =>
        db.transaction((tx) =>
          tx.insert(volunteerShift).values({ ...base, ...row }),
        );
      await expect(
        tryInsert({ seasonId: w.seasonId, eventId: w.eventId }),
      ).rejects.toThrow();
      await expect(tryInsert({})).rejects.toThrow();
      await expect(
        tryInsert({ seasonId: w.seasonId, spots: 0 }),
      ).rejects.toThrow();
      await expect(
        tryInsert({ seasonId: w.seasonId, endsAt: STARTS }),
      ).rejects.toThrow();
    }));
});

describe("claiming and dropping", () => {
  it("takes a spot once, fills up, and frees the spot on drop", () =>
    inRolledBackDb(async (db) => {
      const w = await withShift(db);
      const [a, b, c] = w.members as [UserId, UserId, UserId];
      const claim = (userId: UserId, now = BEFORE) =>
        claimShift(db, {
          shiftId: w.shiftId,
          leagueId: w.leagueId,
          userId,
          now,
        });
      expect((await claim(a)).ok).toBe(true);
      expect(await claim(a)).toEqual({ ok: false, error: "already" });
      expect((await claim(b)).ok).toBe(true);
      expect(await claim(c)).toEqual({ ok: false, error: "full" });
      expect([...(await myShiftIds(db, a, [w.shiftId]))]).toEqual([w.shiftId]);

      expect(
        (await dropShift(db, { shiftId: w.shiftId, userId: a, now: BEFORE }))
          .ok,
      ).toBe(true);
      expect(
        await dropShift(db, { shiftId: w.shiftId, userId: a, now: BEFORE }),
      ).toEqual({ ok: false, error: "not_on" });
      expect((await claim(c)).ok).toBe(true);
      expect(await claim(a, STARTS)).toEqual({ ok: false, error: "started" });
      expect(
        await dropShift(db, { shiftId: w.shiftId, userId: c, now: STARTS }),
      ).toEqual({ ok: false, error: "started" });
    }));

  it("refuses a shift from another league", () =>
    inRolledBackDb(async (db) => {
      const w = await withShift(db);
      const other = await world(db);
      expect(
        await claimShift(db, {
          shiftId: w.shiftId,
          leagueId: other.leagueId,
          userId: w.members[0] as UserId,
          now: BEFORE,
        }),
      ).toEqual({ ok: false, error: "not_found" });
    }));

  it("shows admins who signed up, in order", () =>
    inRolledBackDb(async (db) => {
      const w = await withShift(db);
      const [a, b] = w.members as [UserId, UserId];
      for (const [userId, at] of [
        [b, new Date("2026-10-18T10:00:00Z")],
        [a, new Date("2026-10-18T11:00:00Z")],
      ] as const)
        await claimShift(db, {
          shiftId: w.shiftId,
          leagueId: w.leagueId,
          userId,
          now: at,
        });
      const names = await upcomingVolunteers(db, w.leagueId, BEFORE);
      expect(names).toEqual([
        { shiftId: w.shiftId, name: "Member Number2" },
        { shiftId: w.shiftId, name: "Member Number1" },
      ]);
    }));
});

describe("changing and removing shifts", () => {
  it("won't cut the spots below the people signed up", () =>
    inRolledBackDb(async (db) => {
      const w = await withShift(db);
      const [a, b] = w.members as [UserId, UserId];
      for (const userId of [a, b])
        await claimShift(db, {
          shiftId: w.shiftId,
          leagueId: w.leagueId,
          userId,
          now: BEFORE,
        });
      const update = (spots: number) =>
        updateShift(db, {
          id: w.shiftId,
          leagueId: w.leagueId,
          shift: shiftInput(w, { spots }),
          actorId: w.admin,
        });
      expect(await update(1)).toEqual({ ok: false, error: "too_few_spots" });
      expect((await update(3)).ok).toBe(true);
      expect((await shiftById(db, w.shiftId))?.spots).toBe(3);
    }));

  it("removes a shift with its sign-ups, audited", () =>
    inRolledBackDb(async (db) => {
      const w = await withShift(db);
      await claimShift(db, {
        shiftId: w.shiftId,
        leagueId: w.leagueId,
        userId: w.members[0] as UserId,
        now: BEFORE,
      });
      expect(
        (
          await deleteShift(db, {
            id: w.shiftId,
            leagueId: w.leagueId,
            actorId: w.admin,
          })
        ).ok,
      ).toBe(true);
      expect(
        await db
          .select()
          .from(volunteerSignup)
          .where(eq(volunteerSignup.shiftId, w.shiftId)),
      ).toEqual([]);
      const [audit] = await db
        .select({ before: auditLog.before })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entityId, w.shiftId),
            eq(auditLog.action, "volunteer.delete"),
          ),
        );
      expect(audit?.before).toMatchObject({ signedUp: 1 });
    }));
});

describe("reminders", () => {
  it("reminds each volunteer once, the day before", () =>
    inRolledBackDb(async (db) => {
      const w = await withShift(db);
      const later = await createShift(db, {
        leagueId: w.leagueId,
        shift: shiftInput(w, {
          startsAt: new Date("2026-10-21T22:00:00Z"),
          endsAt: new Date("2026-10-21T23:00:00Z"),
        }),
        actorId: w.admin,
      });
      if (!later.ok) throw new Error(later.error);
      const [a, b] = w.members as [UserId, UserId];
      for (const shiftId of [w.shiftId, later.value])
        for (const userId of [a, b])
          await claimShift(db, {
            shiftId,
            leagueId: w.leagueId,
            userId,
            now: BEFORE,
          });
      const remind = () =>
        queueVolunteerReminders(db, {
          leagueId: w.leagueId,
          today: "2026-10-19",
          timeZone: NY,
        });
      expect(await remind()).toBe(2);
      expect(await remind()).toBe(0);
      const sent = await db
        .select({
          userId: message.userId,
          template: message.template,
          payload: message.payload,
        })
        .from(message)
        .where(like(message.dedupeKey, `volunteer_reminder/${w.shiftId}/%`));
      expect(sent.map((m) => m.userId).sort()).toEqual([a, b].sort());
      expect(sent[0]?.template).toBe("volunteer_reminder");
      expect(sent[0]?.payload).toMatchObject({
        role: "Setup",
        occasion: "Fall Social game day",
        place: "Field 2",
      });
    }));
});

describe("accounts", () => {
  it("exports a member's shifts and gives back future spots on deletion", () =>
    inRolledBackDb(async (db) => {
      const w = await withShift(db);
      const a = w.members[0] as UserId;
      await claimShift(db, {
        shiftId: w.shiftId,
        leagueId: w.leagueId,
        userId: a,
        now: BEFORE,
      });
      const data = await personalData(db, a, BEFORE);
      expect(data.volunteerShifts).toEqual([
        expect.objectContaining({
          role: "setup",
          occasion: "Fall Social game day",
          startsAt: STARTS,
        }),
      ]);
      expect((await deleteAccount(db, a, BEFORE)).ok).toBe(true);
      expect((await upcomingShifts(db, w.leagueId, BEFORE))[0]?.taken).toBe(0);
    }));
});

describe("concurrent claims", () => {
  it("never oversells: six people claiming two spots at once get two", async () => {
    // Real concurrency needs real transactions, so this test commits rows
    // other test files can see. It commits only what no other test reads:
    // people with no profile, a league dated far ahead (never the
    // "current" league), its event and the shift. It removes them after.
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 7,
    });
    const db = drizzle({ client: pool, schema, casing: "snake_case" });
    const tag = Math.random().toString(36).slice(2, 8);
    let made: { leagueId: LeagueId; people: UserId[] } | undefined;
    try {
      const people = await db
        .insert(user)
        .values(
          Array.from({ length: 6 }, (_, i) => ({
            name: `Racer ${i}`,
            email: `vol-race-${i}-${tag}@example.test`,
          })),
        )
        .returning({ id: user.id });
      const [lg] = await db
        .insert(league)
        .values({
          name: "Race League",
          slug: `vol-race-${tag}`,
          createdAt: new Date("2999-01-01T00:00:00Z"),
        })
        .returning({ id: league.id });
      if (!lg) throw new Error("no league");
      made = { leagueId: lg.id, people: people.map((p) => p.id) };
      const [e] = await db
        .insert(event)
        .values({
          leagueId: lg.id,
          kind: "bbq",
          title: "Race BBQ",
          slug: `vol-race-bbq-${tag}`,
          startsAt: STARTS,
          endsAt: ENDS,
        })
        .returning({ id: event.id });
      if (!e) throw new Error("no event");
      const [shift] = await db
        .insert(volunteerShift)
        .values({
          leagueId: lg.id,
          role: "setup",
          eventId: e.id,
          startsAt: STARTS,
          endsAt: ENDS,
          spots: 2,
        })
        .returning({ id: volunteerShift.id });
      if (!shift) throw new Error("no shift");
      const shiftId: VolunteerShiftId = shift.id;
      const tries = await Promise.all(
        made.people.map((userId) =>
          db.transaction((tx) =>
            claimShift(tx, {
              shiftId,
              leagueId: lg.id,
              userId,
              now: BEFORE,
            }),
          ),
        ),
      );
      expect(tries.filter((t) => t.ok)).toHaveLength(2);
      expect(tries.filter((t) => !t.ok && t.error === "full")).toHaveLength(4);
      const rows = await db
        .select({ id: volunteerSignup.id })
        .from(volunteerSignup)
        .where(eq(volunteerSignup.shiftId, shiftId));
      expect(rows).toHaveLength(2);
    } finally {
      if (made) {
        // The event goes first; its shift and sign-ups go with it.
        await db.delete(event).where(eq(event.leagueId, made.leagueId));
        await db.delete(league).where(eq(league.id, made.leagueId));
        await db.delete(user).where(inArray(user.id, made.people));
      }
      await pool.end();
    }
  });
});
