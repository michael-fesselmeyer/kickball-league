import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { toCsv } from "@/domain/export/csv";
import type { SeasonId } from "@/domain/ids";
import { vendorColumns, vendorRows } from "@/domain/shirts/order";
import { auditLog } from "../schema/audit";
import { expense } from "../schema/books";
import { creditEntry } from "../schema/credit";
import { message } from "../schema/message";
import { profile } from "../schema/profile";
import { registration } from "../schema/team";
import { leagueWorld, NOW } from "../test/league-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { createMerchItem, placeMerchOrder } from "./merch";
import type { Db } from "./schedule";
import {
  addOrderToBooks,
  placeShirtOrder,
  receiveShirtOrder,
  remindedCount,
  remindMissingSizes,
  saveShirtSize,
  setSeasonSizes,
  shirtOrderBoard,
  shirtSettings,
  sizesLine,
} from "./shirt-order";

afterAll(closePool);

const LATER = new Date(NOW.getTime() + 86_400_000);

async function statuses(db: Db, seasonId: SeasonId) {
  const rows = await db
    .select({ status: registration.shirtStatus })
    .from(registration)
    .where(eq(registration.seasonId, seasonId));
  return rows.map((r) => r.status).sort();
}

/**
 * Rows written in one rolled-back transaction share occurred_at, so the
 * database can return them in any order; tests compare them sorted.
 */
async function auditActions(db: Db, entityId: string) {
  const rows = await db
    .select({ action: auditLog.action })
    .from(auditLog)
    .where(
      and(eq(auditLog.entityId, entityId), eq(auditLog.entityType, "season")),
    );
  return rows.map((r) => r.action).sort();
}

describe("season sizes", () => {
  it("offers the default sizes until an admin changes them, with an audit row", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      expect((await shirtSettings(db, w.season.id)).sizes).toEqual([
        "xs",
        "s",
        "m",
        "l",
        "xl",
        "xxl",
      ]);
      await setSeasonSizes(db, {
        seasonId: w.season.id,
        sizes: ["s", "m", "l", "xxxl"],
        actorId: w.admin,
      });
      const settings = await shirtSettings(db, w.season.id);
      expect(settings.sizes).toEqual(["s", "m", "l", "xxxl"]);
      expect(settings.status).toBe("not_placed");
      expect(await auditActions(db, w.season.id)).toEqual(["shirts.sizes"]);
      expect(sizesLine(settings.sizes)).toBe("S, M, L and XXXL");
    });
  });

  it("refuses an empty list", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      await expect(
        setSeasonSizes(db, {
          seasonId: w.season.id,
          sizes: [],
          actorId: w.admin,
        }),
      ).rejects.toThrow();
    });
  });

  it("puts the size picked at sign-up on the profile", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      await saveShirtSize(db, { userId: w.agent, size: "xxxl" });
      const [row] = await db
        .select({ size: profile.shirtSize })
        .from(profile)
        .where(eq(profile.userId, w.agent));
      expect(row?.size).toBe("xxxl");
    });
  });
});

describe("the order board and the vendor's CSV", () => {
  it("counts each team's sizes and leaves names out unless asked", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const board = await shirtOrderBoard(db, w.season.id);
      const input = {
        teams: board.teams,
        unplaced: board.freeAgents,
        jerseys: board.jerseys,
        offered: board.settings.sizes,
      };
      const counts = vendorRows(input, false).map(
        (r) => `${r.team} ${r.size} ${r.quantity}`,
      );
      expect(counts).toEqual([
        "Base Invaders XL 1",
        "Kick Bottom M 1",
        "Kick Bottom L 1",
      ]);
      const csv = toCsv(vendorColumns(false), vendorRows(input, false));
      expect(csv).not.toContain("Robin");
      const named = toCsv(vendorColumns(true), vendorRows(input, true));
      expect(named).toContain("Robin Example");
      // A name that would run as a formula is written as text.
      expect(named).toContain(`'=HYPERLINK`);
    });
  });

  it("shows paid replacement jerseys for the season's teams", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const item = await createMerchItem(db, {
        leagueId: w.leagueId,
        values: {
          kind: "team_jersey",
          name: "Replacement jersey",
          description: null,
          priceCents: 1800,
          memberPriceCents: null,
          madeToOrder: true,
          orderDeadline: null,
          sizes: [{ size: "l", stock: 0 }],
        },
        actorId: w.admin,
      });
      await db.insert(creditEntry).values({
        userId: w.teammate,
        leagueId: w.leagueId,
        deltaCents: 5000,
        reason: "goodwill",
        note: "Test",
      });
      const placed = await placeMerchOrder(db, {
        leagueId: w.leagueId,
        itemId: item,
        userId: w.teammate,
        member: false,
        size: "l",
        quantity: "2",
        teamSeasonId: w.teamSeasonId,
        useCredit: true,
        now: NOW,
      });
      expect(placed.ok && placed.value.kind).toBe("paid");
      const board = await shirtOrderBoard(db, w.season.id);
      expect(board.jerseys).toEqual([
        expect.objectContaining({
          teamName: "Kick Bottom",
          size: "l",
          quantity: 2,
        }),
      ]);
      const rows = vendorRows(
        {
          teams: [],
          unplaced: [],
          jerseys: board.jerseys,
          offered: board.settings.sizes,
        },
        false,
      );
      expect(rows).toEqual([
        expect.objectContaining({
          item: "Replacement jersey",
          team: "Kick Bottom",
          size: "L",
          quantity: 2,
          name: null,
        }),
      ]);
    });
  });
});

describe("placing and receiving the order", () => {
  it("marks players with a size ordered, then received, with audit rows", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      expect(
        await receiveShirtOrder(db, {
          seasonId: w.season.id,
          actorId: w.admin,
          now: NOW,
        }),
      ).toEqual({ ok: false, error: "not_placed" });
      expect(
        await placeShirtOrder(db, {
          seasonId: w.season.id,
          costCents: 81_250,
          vendor: "Ink Co (demo)",
          actorId: w.admin,
          now: NOW,
        }),
      ).toEqual({ ok: true, value: { players: 3 } });
      // The free agent has no size and stays not ordered.
      expect(await statuses(db, w.season.id)).toEqual([
        "none",
        "ordered",
        "ordered",
        "ordered",
      ]);
      // Correcting the cost keeps the day it was placed.
      expect(
        await placeShirtOrder(db, {
          seasonId: w.season.id,
          costCents: 80_000,
          vendor: "Ink Co (demo)",
          actorId: w.admin,
          now: LATER,
        }),
      ).toEqual({ ok: true, value: { players: 0 } });
      const placed = await shirtSettings(db, w.season.id);
      expect(placed).toMatchObject({
        status: "placed",
        placedAt: NOW,
        costCents: 80_000,
      });
      expect(
        await receiveShirtOrder(db, {
          seasonId: w.season.id,
          actorId: w.admin,
          now: LATER,
        }),
      ).toEqual({ ok: true, value: { players: 3 } });
      expect(await statuses(db, w.season.id)).toEqual([
        "none",
        "received",
        "received",
        "received",
      ]);
      expect(
        await placeShirtOrder(db, {
          seasonId: w.season.id,
          costCents: null,
          vendor: null,
          actorId: w.admin,
          now: LATER,
        }),
      ).toEqual({ ok: false, error: "already_received" });
      expect(await auditActions(db, w.season.id)).toEqual([
        "shirts.order_place",
        "shirts.order_receive",
        "shirts.order_update",
      ]);
    });
  });
});

describe("who the order counts", () => {
  it("leaves waitlisted and refunded sign-ups out of the counts, the order and the reminders", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      await db
        .update(registration)
        .set({ status: "waitlisted" })
        .where(eq(registration.id, await w.registrationOf(w.otherCaptain)));
      await db
        .update(registration)
        .set({ status: "refunded" })
        .where(eq(registration.id, w.agentRegistration));
      const board = await shirtOrderBoard(db, w.season.id);
      expect(board.freeAgents).toEqual([]);
      const counts = vendorRows(
        {
          teams: board.teams,
          unplaced: board.freeAgents,
          jerseys: [],
          offered: board.settings.sizes,
        },
        false,
      ).map((r) => `${r.team} ${r.size} ${r.quantity}`);
      expect(counts).toEqual(["Kick Bottom M 1", "Kick Bottom L 1"]);
      expect(
        await remindMissingSizes(db, {
          seasonId: w.season.id,
          actorId: w.admin,
          now: NOW,
        }),
      ).toBe(0);
      expect(
        await placeShirtOrder(db, {
          seasonId: w.season.id,
          costCents: null,
          vendor: null,
          actorId: w.admin,
          now: NOW,
        }),
      ).toEqual({ ok: true, value: { players: 2 } });
      expect(await statuses(db, w.season.id)).toEqual([
        "none",
        "none",
        "ordered",
        "ordered",
      ]);
    });
  });
});

describe("once the order is placed", () => {
  it("keeps the season's sizes as they were counted", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      await placeShirtOrder(db, {
        seasonId: w.season.id,
        costCents: null,
        vendor: null,
        actorId: w.admin,
        now: NOW,
      });
      expect(
        await setSeasonSizes(db, {
          seasonId: w.season.id,
          sizes: ["m"],
          actorId: w.admin,
        }),
      ).toEqual({ ok: false, error: "order_placed" });
      expect((await shirtSettings(db, w.season.id)).sizes).toHaveLength(6);
    });
  });

  it("keeps the cost the books were given, while the vendor can still change", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const place = (costCents: number, vendor: string) =>
        placeShirtOrder(db, {
          seasonId: w.season.id,
          costCents,
          vendor,
          actorId: w.admin,
          now: NOW,
        });
      await place(81_250, "Ink Co (demo)");
      const added = await addOrderToBooks(db, {
        leagueId: w.leagueId,
        seasonId: w.season.id,
        spentOn: () => "2027-02-15",
        actorId: w.admin,
      });
      expect(added.ok).toBe(true);
      expect(await place(80_000, "Ink Co (demo)")).toEqual({
        ok: false,
        error: "in_books",
      });
      expect(await place(81_250, "Print Shop (demo)")).toEqual({
        ok: true,
        value: { players: 0 },
      });
      expect(await shirtSettings(db, w.season.id)).toMatchObject({
        costCents: 81_250,
        vendor: "Print Shop (demo)",
      });
    });
  });
});

describe("adding the order to the books", () => {
  it("adds a shirts expense once, only for a placed order with a cost", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const add = () =>
        addOrderToBooks(db, {
          leagueId: w.leagueId,
          seasonId: w.season.id,
          spentOn: () => "2027-02-15",
          actorId: w.admin,
        });
      expect(await add()).toEqual({ ok: false, error: "not_placed" });
      await placeShirtOrder(db, {
        seasonId: w.season.id,
        costCents: null,
        vendor: null,
        actorId: w.admin,
        now: NOW,
      });
      expect(await add()).toEqual({ ok: false, error: "no_cost" });
      await placeShirtOrder(db, {
        seasonId: w.season.id,
        costCents: 81_250,
        vendor: "Ink Co (demo)",
        actorId: w.admin,
        now: NOW,
      });
      const added = await add();
      if (!added.ok) throw new Error(added.error);
      const [row] = await db
        .select({
          category: expense.category,
          amountCents: expense.amountCents,
          spentOn: expense.spentOn,
          note: expense.note,
        })
        .from(expense)
        .where(eq(expense.id, added.value));
      expect(row).toEqual({
        category: "shirts",
        amountCents: 81_250,
        spentOn: "2027-02-15",
        note: "Spring 2027 shirt order from Ink Co (demo)",
      });
      expect(await add()).toEqual({ ok: false, error: "already_in_books" });
      expect((await shirtSettings(db, w.season.id)).expenseId).toBe(
        added.value,
      );
    });
  });

  it("won't add another league's season to the books", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const other = await leagueWorld(db);
      await placeShirtOrder(db, {
        seasonId: w.season.id,
        costCents: 5_000,
        vendor: null,
        actorId: w.admin,
        now: NOW,
      });
      expect(
        await addOrderToBooks(db, {
          leagueId: other.leagueId,
          seasonId: w.season.id,
          spentOn: () => "2027-02-15",
          actorId: other.admin,
        }),
      ).toEqual({ ok: false, error: "unknown_season" });
    });
  });
});

describe("size reminders", () => {
  it("asks each player without an offered size once, ever", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const remind = () =>
        remindMissingSizes(db, {
          seasonId: w.season.id,
          actorId: w.admin,
          now: NOW,
        });
      expect(await remind()).toBe(1);
      expect(await remind()).toBe(0);
      expect(await remindedCount(db, w.season.id)).toBe(1);
      const [sent] = await db
        .select({
          userId: message.userId,
          topic: message.topic,
          payload: message.payload,
        })
        .from(message)
        .where(eq(message.template, "shirt_size_reminder"));
      expect(sent).toEqual({
        userId: w.agent,
        topic: "payment",
        payload: {
          seasonName: "Spring 2027",
          sizes: "XS, S, M, L, XL and XXL",
        },
      });
      // Dropping XL leaves the second team's captain without a size.
      await setSeasonSizes(db, {
        seasonId: w.season.id,
        sizes: ["s", "m", "l"],
        actorId: w.admin,
      });
      expect(await remind()).toBe(1);
      expect(await remind()).toBe(0);
    });
  });
});
