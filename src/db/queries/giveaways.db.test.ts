import { and, eq, getTableColumns, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { can } from "@/domain/authz/permissions";
import {
  blankGiveawayForm,
  DRAW_METHOD,
  type GiveawayInput,
  parseGiveawayForm,
} from "@/domain/drive/giveaway";
import type {
  EventId,
  GiveawayId,
  LeagueId,
  SeasonId,
  UserId,
} from "@/domain/ids";
import * as schema from "../schema";
import { auditLog } from "../schema/audit";
import { user } from "../schema/auth";
import { giveaway, giveawayEntry, giveawayWinner } from "../schema/drive";
import { event } from "../schema/event";
import { league } from "../schema/league";
import { message } from "../schema/message";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { registration } from "../schema/team";
import { closePool, inRolledBackDb } from "../test/transaction";
import { deleteAccount, personalData } from "./account";
import {
  createGiveaway,
  drawGiveaway,
  enterGiveaway,
  entryCount,
  giveawayCodeSecret,
  giveawayStanding,
  giveawayWinners,
  myGiveawayWins,
  redrawWinner,
  updateGiveaway,
} from "./giveaways";
import type { Db } from "./schedule";
import { loadSubject } from "./subject";

afterAll(closePool);

const NY = "America/New_York";
const STARTS = new Date("2027-03-12T23:00:00Z");
const ENDS = new Date("2027-03-13T03:00:00Z");
const DURING = new Date("2027-03-13T00:00:00Z");
const AFTER = new Date("2027-03-13T04:00:00Z");

function prizeInput(over: Partial<GiveawayInput> = {}): GiveawayInput {
  const parsed = parseGiveawayForm(
    {
      ...blankGiveawayForm(
        { title: "Bar night", startsAt: STARTS, endsAt: ENDS },
        NY,
      ),
      prize: "A $50 bar tab",
      winnerCount: "2",
    },
    NY,
  );
  if (!parsed.ok) throw new Error(parsed.error);
  return { ...parsed.value, ...over };
}

/** An invented league with a members' event and a handful of players. */
async function world(db: Db, players = 5) {
  const tag = Math.random().toString(36).slice(2, 8);
  const [lg] = await db
    .insert(league)
    .values({ name: "Giveaway League", slug: `giveaway-${tag}`, timezone: NY })
    .returning({ id: league.id });
  if (!lg) throw new Error("no league");
  const [fall] = await db
    .insert(season)
    .values({
      leagueId: lg.id,
      name: "Fall 2026",
      slug: `fall-${tag}`,
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
  const people = await db
    .insert(user)
    .values(
      Array.from({ length: players + 1 }, (_, i) => ({
        name: i === 0 ? "Ada Admin" : `Player ${i}`,
        email: `giveaway-${i}-${tag}@example.test`,
      })),
    )
    .returning({ id: user.id });
  const [admin, ...rest] = people.map((p) => p.id);
  if (!admin) throw new Error("no admin");
  await db
    .insert(profile)
    .values([
      { userId: admin, globalRole: "admin" as const },
      ...rest.map((userId) => ({ userId })),
    ]);
  await db.insert(registration).values(
    rest.map((userId) => ({
      seasonId: fall.id,
      userId,
      kind: "team_member" as const,
      status: "active" as const,
    })),
  );
  const [e] = await db
    .insert(event)
    .values({
      leagueId: lg.id,
      kind: "bar_night",
      title: "Bar night",
      slug: `bar-night-${tag}`,
      place: "The Example Bar",
      startsAt: STARTS,
      endsAt: ENDS,
      audience: "members",
    })
    .returning({ id: event.id });
  if (!e) throw new Error("no event");
  return {
    leagueId: lg.id,
    seasonId: fall.id,
    eventId: e.id,
    eventSlug: `bar-night-${tag}`,
    admin,
    players: rest,
  };
}

async function withGiveaway(db: Db, players = 5) {
  const w = await world(db, players);
  const created = await createGiveaway(db, {
    eventId: w.eventId,
    giveaway: prizeInput(),
    actorId: w.admin,
  });
  if (!created.ok) throw new Error(created.error);
  return { ...w, giveawayId: created.value };
}

async function enterAll(db: Db, giveawayId: GiveawayId, ids: UserId[]) {
  for (const [i, userId] of ids.entries())
    await enterGiveaway(db, {
      giveawayId,
      userId,
      now: new Date(DURING.getTime() + i * 1000),
    });
}

const audits = (db: Db, giveawayId: GiveawayId, action: string) =>
  db
    .select({ before: auditLog.before, after: auditLog.after })
    .from(auditLog)
    .where(and(eq(auditLog.entityId, giveawayId), eq(auditLog.action, action)));

describe("adding a giveaway", () => {
  it("adds one per event, with a code secret, and audits it", () =>
    inRolledBackDb(async (db) => {
      const w = await withGiveaway(db);
      const again = await createGiveaway(db, {
        eventId: w.eventId,
        giveaway: prizeInput(),
        actorId: w.admin,
      });
      expect(again).toEqual({ ok: false, error: "exists" });
      const secret = await giveawayCodeSecret(db, w.eventId);
      expect(secret?.secret).toMatch(/^[0-9a-f]{64}$/);
      expect(await audits(db, w.giveawayId, "giveaway.create")).toHaveLength(1);
    }));

  it("can be changed until it's drawn", () =>
    inRolledBackDb(async (db) => {
      const w = await withGiveaway(db);
      const changed = await updateGiveaway(db, {
        id: w.giveawayId,
        giveaway: prizeInput({ prize: "Two pitchers" }),
        actorId: w.admin,
      });
      expect(changed.ok).toBe(true);
      await enterAll(db, w.giveawayId, w.players);
      await drawGiveaway(db, {
        giveawayId: w.giveawayId,
        actorId: w.admin,
        now: AFTER,
      });
      expect(
        await updateGiveaway(db, {
          id: w.giveawayId,
          giveaway: prizeInput(),
          actorId: w.admin,
        }),
      ).toEqual({ ok: false, error: "drawn" });
    }));
});

describe("entering", () => {
  it("takes one entry per person, only while entry is open", () =>
    inRolledBackDb(async (db) => {
      const w = await withGiveaway(db);
      const [first] = w.players;
      if (!first) throw new Error("no player");
      const enter = (now: Date) =>
        enterGiveaway(db, { giveawayId: w.giveawayId, userId: first, now });
      expect(await enter(new Date(STARTS.getTime() - 1))).toEqual({
        ok: false,
        error: "closed",
      });
      expect(await enter(DURING)).toEqual({ ok: true, value: { first: true } });
      expect(await enter(DURING)).toEqual({
        ok: true,
        value: { first: false },
      });
      expect(await enter(ENDS)).toEqual({ ok: false, error: "closed" });
      expect(await entryCount(db, w.giveawayId)).toBe(1);
      expect(await giveawayStanding(db, w.giveawayId, first)).toMatchObject({
        entered: true,
        won: false,
        entries: 1,
      });
    }));

  it("is never linked to a payment, a ticket or a registration", () => {
    // No giveaway table has a column that could point at one.
    const columns = [giveaway, giveawayEntry, giveawayWinner].flatMap((t) =>
      Object.values(getTableColumns(t)).map((c) => c.name),
    );
    expect(columns).toContain("userId");
    for (const word of ["purchase", "payment", "ticket", "registration", "fee"])
      expect(columns.filter((c) => c.toLowerCase().includes(word))).toEqual([]);
  });
});

describe("the draw", () => {
  it("waits until entry closes and needs entries", () =>
    inRolledBackDb(async (db) => {
      const w = await withGiveaway(db);
      const draw = (now: Date) =>
        drawGiveaway(db, { giveawayId: w.giveawayId, actorId: w.admin, now });
      expect(await draw(DURING)).toEqual({ ok: false, error: "still_open" });
      expect(await draw(AFTER)).toEqual({ ok: false, error: "no_entries" });
    }));

  it("draws distinct winners from the entries, audits it and tells them once", () =>
    inRolledBackDb(async (db) => {
      const w = await withGiveaway(db);
      await enterAll(db, w.giveawayId, w.players);
      const drawn = await drawGiveaway(db, {
        giveawayId: w.giveawayId,
        actorId: w.admin,
        now: AFTER,
        // Always the last remaining position: the 5th entry, then the 1st
        // (swapped into the last place by the first pick).
        randomInt: (max) => max - 1,
      });
      if (!drawn.ok) throw new Error(drawn.error);
      expect(drawn.value.map((d) => d.userId)).toEqual([
        w.players[4],
        w.players[0],
      ]);
      const [record] = await audits(db, w.giveawayId, "giveaway.draw");
      expect(record?.after).toMatchObject({
        entryCount: 5,
        winnersAsked: 2,
        method: DRAW_METHOD,
        drawnPositions: [4, 0],
      });
      const told = await db
        .select({ userId: message.userId, template: message.template })
        .from(message)
        .where(eq(message.template, "giveaway_win"));
      expect(told.map((t) => t.userId).sort()).toEqual(
        [w.players[4], w.players[0]].sort(),
      );
      expect(
        await drawGiveaway(db, {
          giveawayId: w.giveawayId,
          actorId: w.admin,
          now: AFTER,
        }),
      ).toEqual({ ok: false, error: "drawn" });
      // Entry is over once the winners are drawn.
      const late = await enterGiveaway(db, {
        giveawayId: w.giveawayId,
        userId: w.admin,
        now: DURING,
      });
      expect(late).toEqual({ ok: false, error: "closed" });
      const [winner] = drawn.value;
      if (!winner) throw new Error("no winner");
      const wins = await myGiveawayWins(db, winner.userId);
      expect(wins).toEqual([
        expect.objectContaining({
          prize: "A $50 bar tab",
          eventSlug: w.eventSlug,
        }),
      ]);
    }));

  it("draws everyone when fewer entered than there are prizes", () =>
    inRolledBackDb(async (db) => {
      const w = await withGiveaway(db, 1);
      await enterAll(db, w.giveawayId, w.players);
      const drawn = await drawGiveaway(db, {
        giveawayId: w.giveawayId,
        actorId: w.admin,
        now: AFTER,
      });
      expect(drawn.ok && drawn.value).toHaveLength(1);
    }));
});

describe("a redraw", () => {
  it("replaces one winner with someone who never won, with a reason", () =>
    inRolledBackDb(async (db) => {
      const w = await withGiveaway(db, 3);
      await enterAll(db, w.giveawayId, w.players);
      await drawGiveaway(db, {
        giveawayId: w.giveawayId,
        actorId: w.admin,
        now: AFTER,
      });
      const [first] = await giveawayWinners(db, w.giveawayId);
      if (!first) throw new Error("no winner");
      const redraw = () =>
        redrawWinner(db, {
          giveawayId: w.giveawayId,
          winnerId: first.id,
          reason: "Didn't claim in 14 days",
          actorId: w.admin,
          now: new Date(AFTER.getTime() + 1000),
        });
      const again = await redraw();
      if (!again.ok) throw new Error(again.error);
      const all = await giveawayWinners(db, w.giveawayId);
      expect(all).toHaveLength(3);
      expect(new Set(all.map((x) => x.userId)).size).toBe(3);
      expect(all.find((x) => x.id === first.id)).toMatchObject({
        replacedReason: "Didn't claim in 14 days",
      });
      expect(all.at(-1)).toMatchObject({ round: 2, replacedAt: null });
      const [record] = await audits(db, w.giveawayId, "giveaway.redraw");
      expect(record?.after).toMatchObject({
        reason: "Didn't claim in 14 days",
        eligibleCount: 1,
        method: DRAW_METHOD,
      });
      expect(await myGiveawayWins(db, first.userId)).toEqual([]);
      // The same winner can't be replaced twice, and nobody is left anyway.
      expect(await redraw()).toEqual({ ok: false, error: "not_a_winner" });
      const [current] = (await giveawayWinners(db, w.giveawayId)).filter(
        (x) => x.replacedAt === null,
      );
      if (!current) throw new Error("no current winner");
      expect(
        await redrawWinner(db, {
          giveawayId: w.giveawayId,
          winnerId: current.id,
          reason: "Moved away",
          actorId: w.admin,
          now: AFTER,
        }),
      ).toEqual({ ok: false, error: "no_one_left" });
    }));
});

describe("permissions and accounts", () => {
  it("lets players enter and only admins run the giveaway", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db, 1);
      const [player] = w.players;
      if (!player) throw new Error("no player");
      const admin = await loadSubject(db, w.admin);
      const someone = await loadSubject(db, player);
      expect(can(someone, "giveaway.enter")).toBe(true);
      expect(can(someone, "giveaway.manage")).toBe(false);
      expect(can(admin, "giveaway.manage")).toBe(true);
      expect(can(await loadSubject(db, null), "giveaway.enter")).toBe(false);
    }));

  it("exports entries and wins, and keeps a drawn giveaway's entries on deletion", () =>
    inRolledBackDb(async (db) => {
      const w = await withGiveaway(db, 2);
      await enterAll(db, w.giveawayId, w.players);
      const [a, b] = w.players;
      if (!a || !b) throw new Error("no players");
      const data = await personalData(db, a, DURING);
      expect(data?.giveawayEntries).toEqual([
        expect.objectContaining({ prize: "A $50 bar tab" }),
      ]);
      // Not drawn yet: deleting the account takes the entry out.
      expect((await deleteAccount(db, a, DURING)).ok).toBe(true);
      expect(await entryCount(db, w.giveawayId)).toBe(1);
      await drawGiveaway(db, {
        giveawayId: w.giveawayId,
        actorId: w.admin,
        now: AFTER,
      });
      expect((await deleteAccount(db, b, AFTER)).ok).toBe(true);
      expect(await entryCount(db, w.giveawayId)).toBe(1);
    }));
});

describe("entering at the same moment", () => {
  it("keeps one entry per person when the same check-in lands five times at once", async () => {
    // Real concurrency needs real transactions, so this test commits to its
    // own invented league and removes it afterwards.
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 6,
    });
    const db = drizzle({ client: pool, schema, casing: "snake_case" });
    let made:
      | {
          leagueId: LeagueId;
          seasonId: SeasonId;
          eventId: EventId;
          people: UserId[];
        }
      | undefined;
    try {
      const w = await withGiveaway(db, 2);
      made = {
        leagueId: w.leagueId,
        seasonId: w.seasonId,
        eventId: w.eventId,
        people: [w.admin, ...w.players],
      };
      const [player, other] = w.players;
      if (!player || !other) throw new Error("no players");
      const tries = await Promise.all(
        [player, player, player, player, player, other, other].map((userId) =>
          db.transaction((tx) =>
            enterGiveaway(tx, {
              giveawayId: w.giveawayId,
              userId,
              now: DURING,
            }),
          ),
        ),
      );
      expect(tries.every((t) => t.ok)).toBe(true);
      expect(tries.filter((t) => t.ok && t.value.first)).toHaveLength(2);
      const rows = await db
        .select({ userId: giveawayEntry.userId })
        .from(giveawayEntry)
        .where(eq(giveawayEntry.giveawayId, w.giveawayId));
      expect(rows.map((r) => r.userId).sort()).toEqual([player, other].sort());
    } finally {
      if (made) {
        await db.delete(event).where(eq(event.id, made.eventId));
        await db
          .delete(registration)
          .where(eq(registration.seasonId, made.seasonId));
        await db.delete(season).where(eq(season.id, made.seasonId));
        await db.delete(league).where(eq(league.id, made.leagueId));
        await db.delete(auditLog).where(inArray(auditLog.actorId, made.people));
        await db.delete(profile).where(inArray(profile.userId, made.people));
        await db.delete(user).where(inArray(user.id, made.people));
      }
      await pool.end();
    }
  });
});

// Keep the cascade honest: removing an event removes its giveaway.
describe("removing an event", () => {
  it("takes its giveaway, entries and winners with it", () =>
    inRolledBackDb(async (db) => {
      const w = await withGiveaway(db, 2);
      await enterAll(db, w.giveawayId, w.players);
      await drawGiveaway(db, {
        giveawayId: w.giveawayId,
        actorId: w.admin,
        now: AFTER,
      });
      await db.delete(event).where(eq(event.id, w.eventId));
      expect(
        await db.select().from(giveaway).where(eq(giveaway.id, w.giveawayId)),
      ).toEqual([]);
      expect(
        await db
          .select()
          .from(giveawayEntry)
          .where(eq(giveawayEntry.giveawayId, w.giveawayId)),
      ).toEqual([]);
      expect(
        await db
          .select()
          .from(giveawayWinner)
          .where(eq(giveawayWinner.giveawayId, w.giveawayId)),
      ).toEqual([]);
    }));
});
