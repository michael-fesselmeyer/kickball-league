import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  parseId,
  type RegistrationId,
  type TeamSeasonId,
  type UserId,
} from "@/domain/ids";
import { BATCH_MINIMUM } from "@/domain/shirts/late";
import type { ShirtSize } from "@/domain/shirts/summary";
import { auditLog } from "../schema/audit";
import { user } from "../schema/auth";
import { profile } from "../schema/profile";
import { shirtSpare } from "../schema/shirt-late";
import { registration, rosterMembership } from "../schema/team";
import { leagueWorld, NOW } from "../test/league-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import type { Db } from "./schedule";
import {
  handOutSpare,
  lateShirtBoard,
  logSpare,
  markBatchOrdered,
  receiveBatch,
  setOwnShirts,
  setShirtDesign,
  spareStock,
  waitingRows,
} from "./shirt-late";
import {
  placeShirtOrder,
  receiveShirtOrder,
  shirtOrderBoard,
} from "./shirt-order";

afterAll(closePool);

const TODAY = "2027-05-01";

/** The season's order goes in, then new players join teams late. */
async function placeOrder(db: Db, w: Awaited<ReturnType<typeof leagueWorld>>) {
  const result = await placeShirtOrder(db, {
    seasonId: w.season.id,
    costCents: null,
    vendor: null,
    actorId: w.admin,
    now: NOW,
  });
  if (!result.ok) throw new Error(result.error);
}

let counter = 0;
async function lateJoiner(
  db: Db,
  w: Awaited<ReturnType<typeof leagueWorld>>,
  teamSeasonId: TeamSeasonId,
  size: ShirtSize | null,
  status: "active" | "pending_waiver" | "cancelled" | "waitlisted" = "active",
): Promise<{ userId: UserId; registrationId: RegistrationId }> {
  const n = ++counter;
  const [u] = await db
    .insert(user)
    .values({
      name: `Late ${n}`,
      email: `late-${n}-${Date.now()}@example.test`,
    })
    .returning({ id: user.id });
  if (!u) throw new Error("no user");
  await db.insert(profile).values({
    userId: u.id,
    firstName: "Late",
    lastName: `Joiner${n}`,
    shirtSize: size,
  });
  const [reg] = await db
    .insert(registration)
    .values({
      seasonId: w.season.id,
      userId: u.id,
      kind: "team_member",
      status,
    })
    .returning({ id: registration.id });
  if (!reg) throw new Error("no registration");
  await db.insert(rosterMembership).values({
    teamSeasonId,
    registrationId: reg.id,
    role: "player",
    status: "active",
    startedAt: NOW,
  });
  return { userId: u.id, registrationId: reg.id };
}

describe("the waiting list", () => {
  it("is empty until the season's order is placed", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      await lateJoiner(db, w, w.teamSeasonId, "m");
      expect(await waitingRows(db, w.leagueId, TODAY)).toEqual([]);
    });
  });

  it("collects late joiners across teams by size, and is ready at the batch minimum", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      await placeOrder(db, w);
      for (let i = 0; i < 5; i++) await lateJoiner(db, w, w.teamSeasonId, "m");
      for (let i = 0; i < BATCH_MINIMUM - 5; i++)
        await lateJoiner(db, w, w.otherTeamSeasonId, "l");
      const { rows, summary } = await lateShirtBoard(db, w.leagueId, TODAY);
      expect(rows).toHaveLength(BATCH_MINIMUM);
      expect(summary.byTeam.map((t) => [t.teamName, t.total])).toEqual([
        ["Base Invaders", BATCH_MINIMUM - 5],
        ["Kick Bottom", 5],
      ]);
      expect(summary.bySize.m).toBe(5);
      expect(summary.batchReady).toBe(true);
    });
  });

  it("leaves out players with no size, cancelled and waitlisted sign-ups, free agents and past seasons", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      await placeOrder(db, w);
      await lateJoiner(db, w, w.teamSeasonId, null);
      await lateJoiner(db, w, w.teamSeasonId, "m", "cancelled");
      await lateJoiner(db, w, w.teamSeasonId, "m", "waitlisted");
      const counted = await lateJoiner(db, w, w.teamSeasonId, "s");
      const rows = await waitingRows(db, w.leagueId, TODAY);
      expect(rows.map((r) => r.registrationId)).toEqual([
        counted.registrationId,
      ]);
      // The free agent has no team, so is not on a team's list.
      expect(rows.some((r) => r.registrationId === w.agentRegistration)).toBe(
        false,
      );
      expect(await waitingRows(db, w.leagueId, "2027-07-01")).toEqual([]);
    });
  });

  it("does not count a player whose shirt is already ordered", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      await placeOrder(db, w);
      await lateJoiner(db, w, w.teamSeasonId, "m");
      await markBatchOrdered(db, {
        leagueId: w.leagueId,
        actorId: w.admin,
        today: TODAY,
      });
      expect(await waitingRows(db, w.leagueId, TODAY)).toEqual([]);
    });
  });
});

describe("spare stock", () => {
  it("logs spares and hands them out one at a time, never below zero", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      await placeOrder(db, w);
      const a = await lateJoiner(db, w, w.teamSeasonId, "m");
      const b = await lateJoiner(db, w, w.otherTeamSeasonId, "m");
      await logSpare(db, {
        leagueId: w.leagueId,
        size: "m",
        quantity: 1,
        note: "left from fall",
        actorId: w.admin,
      });
      expect(await spareStock(db, w.leagueId)).toEqual({ m: 1 });
      const first = await handOutSpare(db, {
        leagueId: w.leagueId,
        registrationId: a.registrationId,
        actorId: w.admin,
      });
      expect(first).toEqual({ ok: true, value: { size: "m" } });
      const second = await handOutSpare(db, {
        leagueId: w.leagueId,
        registrationId: b.registrationId,
        actorId: w.admin,
      });
      expect(second).toEqual({ ok: false, error: "none_in_stock" });
      expect(await spareStock(db, w.leagueId)).toEqual({});
      const [row] = await db
        .select({ status: registration.shirtStatus })
        .from(registration)
        .where(eq(registration.id, a.registrationId));
      expect(row?.status).toBe("received");
      const ledger = await db
        .select({ delta: shirtSpare.delta })
        .from(shirtSpare)
        .where(eq(shirtSpare.leagueId, w.leagueId));
      expect(ledger.map((l) => l.delta).sort()).toEqual([-1, 1]);
    });
  });

  it("refuses a player who already has a shirt, has no size, or is in another league", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const noSize = await lateJoiner(db, w, w.teamSeasonId, null);
      const has = await lateJoiner(db, w, w.teamSeasonId, "m");
      await db
        .update(registration)
        .set({ shirtStatus: "received" })
        .where(eq(registration.id, has.registrationId));
      await logSpare(db, {
        leagueId: w.leagueId,
        size: "m",
        quantity: 2,
        note: null,
        actorId: w.admin,
      });
      const hand = (registrationId: RegistrationId, leagueId = w.leagueId) =>
        handOutSpare(db, { leagueId, registrationId, actorId: w.admin });
      expect(await hand(noSize.registrationId)).toEqual({
        ok: false,
        error: "no_size",
      });
      expect(await hand(has.registrationId)).toEqual({
        ok: false,
        error: "has_shirt",
      });
      const other = await leagueWorld(db);
      expect(await hand(has.registrationId, other.leagueId)).toEqual({
        ok: false,
        error: "not_found",
      });
    });
  });

  it("counts spares against the waiting list before a batch", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      await placeOrder(db, w);
      for (let i = 0; i < BATCH_MINIMUM; i++)
        await lateJoiner(db, w, w.teamSeasonId, "m");
      await logSpare(db, {
        leagueId: w.leagueId,
        size: "m",
        quantity: 3,
        note: null,
        actorId: w.admin,
      });
      const { summary } = await lateShirtBoard(db, w.leagueId, TODAY);
      expect(summary.toOrder).toBe(BATCH_MINIMUM - 3);
      expect(summary.batchReady).toBe(false);
    });
  });
});

describe("the batch reorder", () => {
  it("marks the waiting list ordered, then received once the season's order is in", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      await placeOrder(db, w);
      const late = await lateJoiner(db, w, w.teamSeasonId, "l");
      expect(
        await markBatchOrdered(db, {
          leagueId: w.leagueId,
          actorId: w.admin,
          today: TODAY,
        }),
      ).toBe(1);
      const status = async () =>
        (
          await db
            .select({ s: registration.shirtStatus })
            .from(registration)
            .where(eq(registration.id, late.registrationId))
        )[0]?.s;
      expect(await status()).toBe("ordered");
      // The season's own order is still on its way: nothing is received.
      expect(
        await receiveBatch(db, { leagueId: w.leagueId, actorId: w.admin }),
      ).toBe(0);
      await receiveShirtOrder(db, {
        seasonId: w.season.id,
        actorId: w.admin,
        now: NOW,
      });
      // That order received everything marked ordered, the batch included.
      expect(await status()).toBe("received");
    });
  });

  it("receives batch shirts in a season whose order already arrived", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      await placeOrder(db, w);
      await receiveShirtOrder(db, {
        seasonId: w.season.id,
        actorId: w.admin,
        now: NOW,
      });
      const late = await lateJoiner(db, w, w.teamSeasonId, "l");
      await markBatchOrdered(db, {
        leagueId: w.leagueId,
        actorId: w.admin,
        today: TODAY,
      });
      expect(
        await receiveBatch(db, { leagueId: w.leagueId, actorId: w.admin }),
      ).toBe(1);
      const [row] = await db
        .select({ s: registration.shirtStatus })
        .from(registration)
        .where(eq(registration.id, late.registrationId));
      expect(row?.s).toBe("received");
    });
  });
});

describe("a captain's own shirts", () => {
  it("takes the team off the waiting list and out of the order, and back", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      await placeOrder(db, w);
      await lateJoiner(db, w, w.teamSeasonId, "m");
      const other = await lateJoiner(db, w, w.otherTeamSeasonId, "m");
      const result = await setOwnShirts(db, {
        teamSeasonId: w.teamSeasonId,
        own: true,
        actorId: w.captain,
      });
      // Everyone already on the team was in the order placed above.
      expect(result.ok && result.value.alreadyOrdered).toBeGreaterThan(0);
      const rows = await waitingRows(db, w.leagueId, TODAY);
      expect(rows.map((r) => r.registrationId)).toEqual([other.registrationId]);
      await setOwnShirts(db, {
        teamSeasonId: w.teamSeasonId,
        own: false,
        actorId: w.captain,
      });
      expect(await waitingRows(db, w.leagueId, TODAY)).toHaveLength(2);
      const actions = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entityId, w.teamSeasonId),
            eq(auditLog.action, "shirts.own_shirts"),
          ),
        );
      expect(actions).toHaveLength(2);
    });
  });

  it("keeps a team out of the season's order when it opts out before it is placed", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      await setOwnShirts(db, {
        teamSeasonId: w.teamSeasonId,
        own: true,
        actorId: w.captain,
      });
      const before = await shirtOrderBoard(db, w.season.id);
      expect(before.teams.map((t) => t.name)).toEqual(["Base Invaders"]);
      expect(before.ownShirtTeams.map((t) => t.name)).toEqual(["Kick Bottom"]);
      await placeOrder(db, w);
      const rows = await db
        .select({ s: registration.shirtStatus })
        .from(registration)
        .innerJoin(
          rosterMembership,
          eq(rosterMembership.registrationId, registration.id),
        )
        .where(eq(rosterMembership.teamSeasonId, w.teamSeasonId));
      expect(rows.every((r) => r.s === "none")).toBe(true);
    });
  });

  it("keeps already-ordered players in the order when a team opts out after it", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      await placeOrder(db, w);
      await setOwnShirts(db, {
        teamSeasonId: w.teamSeasonId,
        own: true,
        actorId: w.captain,
      });
      const board = await shirtOrderBoard(db, w.season.id);
      const team = board.teams.find((t) => t.teamSeasonId === w.teamSeasonId);
      expect(team?.players.length).toBeGreaterThan(0);
    });
  });

  it("refuses an unknown team", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const unknown = parseId<TeamSeasonId>(randomUUID());
      if (!unknown) throw new Error("bad id");
      const result = await setOwnShirts(db, {
        teamSeasonId: unknown,
        own: true,
        actorId: w.captain,
      });
      expect(result).toEqual({ ok: false, error: "not_found" });
    });
  });
});

describe("the shirt design", () => {
  it("is saved, cleared and audited once per change", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const set = (design: string | null) =>
        setShirtDesign(db, {
          teamSeasonId: w.teamSeasonId,
          design,
          actorId: w.captain,
        });
      await set("Red with white sleeves");
      await set("Red with white sleeves");
      await set(null);
      const rows = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.entityId, w.teamSeasonId));
      expect(rows.filter((r) => r.action === "shirts.design")).toHaveLength(2);
    });
  });
});
