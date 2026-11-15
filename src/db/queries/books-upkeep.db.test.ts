import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { readStatement } from "@/domain/books/statement";
import type { PreparedFile } from "@/lib/books/store-file";
import { expense } from "../schema/books";
import { field, game, slot, venue } from "../schema/game";
import { message } from "../schema/message";
import { refereePayout, refereePayRate } from "../schema/referees";
import { season } from "../schema/season";
import { grantRole } from "../test/leagues";
import { leagueWorld } from "../test/league-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { addExpense } from "./books";
import {
  addRecurringCost,
  archiveRecurringCost,
  attachReceipt,
  confirmExpected,
  importKeyOf,
  importStatementRows,
  lastCategory,
  markNoReceipt,
  owedList,
  previewStatement,
  queueBooksNudge,
  refPaySummary,
  reimburse,
  seasonExpected,
  skipExpected,
} from "./books-upkeep";
import type { Db } from "./schedule";

afterAll(closePool);

const TZ = "America/New_York";

const fakeFile = (): PreparedFile => {
  const bytes = Buffer.alloc(64, 7);
  return {
    contentType: "image/webp",
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
};

/**
 * Spring 2027 (April 5 to June 28) with games on April 10 and 17, and a
 * cancelled one on April 24. Casey is an owner.
 */
async function booksWorld(db: Db) {
  const w = await leagueWorld(db);
  await grantRole(db, w.admin, "owner", w.leagueId);
  const [v] = await db
    .insert(venue)
    .values({ leagueId: w.leagueId, name: "Example Park", slug: "ex-park" })
    .returning({ id: venue.id });
  if (!v) throw new Error("no venue");
  const [f] = await db
    .insert(field)
    .values({ venueId: v.id, name: "Field 1" })
    .returning({ id: field.id });
  if (!f) throw new Error("no field");
  const days = ["2027-04-10", "2027-04-17", "2027-04-24"];
  const slots = await db
    .insert(slot)
    .values(
      days.map((d) => ({
        seasonId: w.season.id,
        fieldId: f.id,
        startsAt: new Date(`${d}T18:00:00Z`),
        endsAt: new Date(`${d}T19:00:00Z`),
        timeIndex: 0,
      })),
    )
    .returning({ id: slot.id });
  await db.insert(game).values(
    slots.map((s, i) => ({
      seasonId: w.season.id,
      teamAId: w.teamSeasonId,
      teamBId: w.otherTeamSeasonId,
      slotId: s.id,
      status: i === 2 ? ("cancelled" as const) : ("scheduled" as const),
    })),
  );
  const season = {
    id: w.season.id,
    startsOn: "2027-04-05",
    endsOn: "2027-06-28",
  };
  const owner = w.admin;
  const add = (
    cents: number,
    extra: Partial<Parameters<typeof addExpense>[1]> = {},
  ) =>
    addExpense(
      db,
      {
        leagueId: w.leagueId,
        seasonId: w.season.id,
        spentOn: "2027-04-12",
        amountCents: cents,
        category: "equipment",
        note: "",
        receipt: null,
        ...extra,
      },
      owner,
    );
  return { ...w, season, owner, add };
}

describe("quick add", () => {
  it("keeps 'there isn't one', preselects the newest category, and checks who paid", async () => {
    await inRolledBackDb(async (db) => {
      const w = await booksWorld(db);
      expect(await lastCategory(db, w.leagueId)).toBeNull();
      const none = await w.add(1500, { noReceipt: true, category: "shirts" });
      if (!none.ok) throw new Error(none.error);
      const [row] = await db
        .select({ noReceipt: expense.noReceipt })
        .from(expense)
        .where(eq(expense.id, none.value));
      expect(row?.noReceipt).toBe(true);
      expect(await lastCategory(db, w.leagueId)).toBe("shirts");

      expect(await w.add(100, { paidBy: w.teammate })).toEqual({
        ok: false,
        error: "unknown_payer",
      });
      expect((await w.add(100, { paidBy: w.owner })).ok).toBe(true);
    });
  });

  it("preselects what an owner typed last, not an import or a confirmed cost", async () => {
    await inRolledBackDb(async (db) => {
      const w = await booksWorld(db);
      await w.add(1500, { category: "shirts" });
      await w.add(900, { category: "events", importKey: "b".repeat(64) });
      const cost = await addRecurringCost(
        db,
        {
          leagueId: w.leagueId,
          label: "Ref pay",
          category: "refs",
          amountCents: 12000,
          cadence: "game_day",
          startsOn: "2027-01-01",
        },
        w.owner,
      );
      await w.add(12000, {
        category: "refs",
        occurrence: { recurringCostId: cost, dueOn: "2027-04-10" },
      });
      expect(await lastCategory(db, w.leagueId)).toBe("shirts");
    });
  });

  it("adds a receipt later, which clears 'there isn't one'", async () => {
    await inRolledBackDb(async (db) => {
      const w = await booksWorld(db);
      const added = await w.add(2500);
      if (!added.ok) throw new Error(added.error);
      const ref = { leagueId: w.leagueId, expenseId: added.value };
      expect((await markNoReceipt(db, ref, w.owner)).ok).toBe(true);
      expect(
        (await attachReceipt(db, { ...ref, receipt: fakeFile() }, w.owner)).ok,
      ).toBe(true);
      const [row] = await db
        .select({ noReceipt: expense.noReceipt, file: expense.receiptFileId })
        .from(expense)
        .where(eq(expense.id, added.value));
      expect(row?.noReceipt).toBe(false);
      expect(row?.file).not.toBeNull();
      expect(await markNoReceipt(db, ref, w.owner)).toEqual({
        ok: false,
        error: "has_receipt",
      });
    });
  });
});

describe("expected costs", () => {
  it("lists due costs, confirms each once at the owner's amount, and skips", async () => {
    await inRolledBackDb(async (db) => {
      const w = await booksWorld(db);
      const ref = await addRecurringCost(
        db,
        {
          leagueId: w.leagueId,
          label: "Ref pay",
          category: "refs",
          amountCents: 12000,
          cadence: "game_day",
          startsOn: "2027-01-01",
        },
        w.owner,
      );
      await addRecurringCost(
        db,
        {
          leagueId: w.leagueId,
          label: "Field permit",
          category: "fields_permits",
          amountCents: 45000,
          cadence: "season",
          startsOn: "2027-01-01",
        },
        w.owner,
      );
      const at = {
        leagueId: w.leagueId,
        season: w.season,
        timeZone: TZ,
        today: "2027-04-30",
      };
      const before = await seasonExpected(db, at);
      expect(before.due.map((o) => `${o.label} ${o.dueOn}`)).toEqual([
        "Field permit 2027-04-05",
        "Ref pay 2027-04-10",
        "Ref pay 2027-04-17",
      ]);

      const confirmed = await confirmExpected(
        db,
        {
          ...at,
          costId: ref,
          dueOn: "2027-04-10",
          amountCents: 13000,
          paidBy: w.owner,
        },
        w.owner,
      );
      expect(confirmed.ok).toBe(true);
      const [row] = await db
        .select()
        .from(expense)
        .where(eq(expense.recurringCostId, ref));
      expect(row).toMatchObject({
        spentOn: "2027-04-10",
        amountCents: 13000,
        category: "refs",
        paidBy: w.owner,
      });
      expect(
        await confirmExpected(
          db,
          {
            ...at,
            costId: ref,
            dueOn: "2027-04-10",
            amountCents: 13000,
            paidBy: null,
          },
          w.owner,
        ),
      ).toEqual({ ok: false, error: "not_expected" });

      expect(
        (
          await skipExpected(
            db,
            { ...at, costId: ref, dueOn: "2027-04-17" },
            w.owner,
          )
        ).ok,
      ).toBe(true);
      expect(
        await skipExpected(
          db,
          { ...at, costId: ref, dueOn: "2027-04-17" },
          w.owner,
        ),
      ).toEqual({ ok: false, error: "not_expected" });
      // The cancelled game day is never expected, and nothing after today.
      expect(
        await skipExpected(
          db,
          { ...at, costId: ref, dueOn: "2027-04-24" },
          w.owner,
        ),
      ).toEqual({ ok: false, error: "not_expected" });

      const after = await seasonExpected(db, at);
      expect(after.due.map((o) => o.label)).toEqual(["Field permit"]);

      await archiveRecurringCost(
        db,
        { leagueId: w.leagueId, costId: ref },
        w.owner,
        new Date(),
      );
      const [kept] = await db
        .select({ id: expense.id })
        .from(expense)
        .where(eq(expense.recurringCostId, ref));
      expect(kept).toBeDefined();
    });
  });

  it("stays settled when the season's first day moves, and overlapping seasons settle apart", async () => {
    await inRolledBackDb(async (db) => {
      const w = await booksWorld(db);
      const cost = (cadence: "season" | "game_day", label: string) =>
        addRecurringCost(
          db,
          {
            leagueId: w.leagueId,
            label,
            category: "refs",
            amountCents: 12000,
            cadence,
            startsOn: "2027-01-01",
          },
          w.owner,
        );
      const permit = await cost("season", "Permit");
      const ref = await cost("game_day", "Ref pay");
      const at = {
        leagueId: w.leagueId,
        season: w.season,
        timeZone: TZ,
        today: "2027-04-30",
      };
      const confirm = (on: typeof at, costId: typeof permit, dueOn: string) =>
        confirmExpected(
          db,
          { ...on, costId, dueOn, amountCents: 12000, paidBy: null },
          w.owner,
        );
      expect((await confirm(at, permit, "2027-04-05")).ok).toBe(true);
      expect((await confirm(at, ref, "2027-04-10")).ok).toBe(true);

      // The admins move the season's first day after it was confirmed.
      await db
        .update(season)
        .set({ startsOn: "2027-04-08" })
        .where(eq(season.id, w.season.id));
      const moved = { ...at, season: { ...w.season, startsOn: "2027-04-08" } };
      expect((await seasonExpected(db, moved)).due.map((o) => o.label)).toEqual(
        ["Ref pay"],
      );

      // A second season running alongside, with games on April 10 too.
      const [other] = await db
        .insert(season)
        .values({
          leagueId: w.leagueId,
          name: "Spring 2027 Wednesdays",
          slug: "spring-2027-wed",
          status: "in_progress",
          startsOn: "2027-04-07",
          endsOn: "2027-06-30",
          feeModel: "per_player",
          playerFeeCents: 4500,
          freeAgentFeeCents: 4500,
          rosterMin: 1,
          rosterMax: 20,
        })
        .returning({ id: season.id });
      if (!other) throw new Error("no season");
      const [f] = await db
        .select({ fieldId: slot.fieldId })
        .from(slot)
        .where(eq(slot.seasonId, w.season.id))
        .limit(1);
      if (!f) throw new Error("no field");
      const [s] = await db
        .insert(slot)
        .values({
          seasonId: other.id,
          fieldId: f.fieldId,
          startsAt: new Date("2027-04-10T22:00:00Z"),
          endsAt: new Date("2027-04-10T23:00:00Z"),
          timeIndex: 1,
        })
        .returning({ id: slot.id });
      await db.insert(game).values({
        seasonId: other.id,
        teamAId: w.teamSeasonId,
        teamBId: w.otherTeamSeasonId,
        slotId: s?.id,
      });
      const alongside = {
        ...at,
        season: { id: other.id, startsOn: "2027-04-07", endsOn: "2027-06-30" },
      };
      expect(
        (await seasonExpected(db, alongside)).due.map(
          (o) => `${o.label} ${o.dueOn}`,
        ),
      ).toEqual(["Permit 2027-04-07", "Ref pay 2027-04-10"]);
      expect((await confirm(alongside, ref, "2027-04-10")).ok).toBe(true);
    });
  });
});

describe("out of pocket", () => {
  it("shows who is owed, and 'Reimbursed' clears only what was listed", async () => {
    await inRolledBackDb(async (db) => {
      const w = await booksWorld(db);
      await w.add(24000, { paidBy: w.owner, category: "shirts" });
      await w.add(2000, { paidBy: w.owner });
      await w.add(9900);
      const [owed] = await owedList(db, w.leagueId);
      expect(owed).toMatchObject({
        paidBy: w.owner,
        name: "Casey Admin",
        cents: 26000,
      });
      // Added after the list was shown, so it stays owed.
      await w.add(500, { paidBy: w.owner });
      const paid = await reimburse(
        db,
        {
          leagueId: w.leagueId,
          paidBy: w.owner,
          expenseIds: owed?.expenseIds ?? [],
        },
        w.owner,
        new Date(),
      );
      expect(paid).toEqual({ ok: true, value: 26000 });
      expect(await owedList(db, w.leagueId)).toEqual([
        expect.objectContaining({ cents: 500 }),
      ]);
      expect(
        await reimburse(
          db,
          {
            leagueId: w.leagueId,
            paidBy: w.owner,
            expenseIds: owed?.expenseIds ?? [],
          },
          w.owner,
          new Date(),
        ),
      ).toEqual({ ok: false, error: "nothing_owed" });
    });
  });
});

const STATEMENT = [
  "Posting Date,Description,Amount",
  "04/11/2027,EXAMPLE SPORTING GOODS CARD 4417123412341234,-25.00",
  "04/12/2027,THE EXAMPLE TAVERN DEPOSIT,-200.00",
  "04/13/2027,TRANSFER IN,300.00",
].join("\n");

describe("statement import", () => {
  it("previews with guesses, flags hand-entered ones, imports once and stores no account number", async () => {
    await inRolledBackDb(async (db) => {
      const w = await booksWorld(db);
      // Entered by hand the day before the bank posted it.
      await w.add(2500, { spentOn: "2027-04-10" });
      const read = readStatement(STATEMENT);
      if (!read.ok) throw new Error(read.error);
      const preview = await previewStatement(db, {
        leagueId: w.leagueId,
        rows: read.value.rows,
      });
      expect(preview.map((r) => [r.category, r.status])).toEqual([
        ["equipment", "maybe_entered"],
        ["events", "new"],
      ]);

      const rows = preview.map((r) => ({
        ...r,
        category: r.category ?? "other",
      }));
      const first = await importStatementRows(
        db,
        { leagueId: w.leagueId, seasonId: w.season.id, rows },
        w.owner,
      );
      expect(first).toEqual({ ok: true, value: { imported: 2, skipped: 0 } });
      const again = await importStatementRows(
        db,
        { leagueId: w.leagueId, seasonId: w.season.id, rows },
        w.owner,
      );
      expect(again).toEqual({ ok: true, value: { imported: 0, skipped: 2 } });

      const stored = await db
        .select({ note: expense.note, key: expense.importKey })
        .from(expense)
        .where(
          and(
            eq(expense.seasonId, w.season.id),
            eq(expense.importKey, importKeyOf(w.leagueId, rows[0]?.key ?? "")),
          ),
        );
      expect(stored).toHaveLength(1);
      expect(JSON.stringify(stored)).not.toContain("4417123412341234");
      expect(stored[0]?.key).toMatch(/^[0-9a-f]{64}$/);

      const later = await previewStatement(db, {
        leagueId: w.leagueId,
        rows: read.value.rows,
      });
      expect(later.map((r) => r.status)).toEqual(["imported", "imported"]);
    });
  });

  it("starts transfers and rows far outside the season unticked", async () => {
    await inRolledBackDb(async (db) => {
      const w = await booksWorld(db);
      const read = readStatement(
        [
          "Date,Description,Amount",
          "2026-11-20,NYC PARKS PERMIT,-450.00",
          "2026-12-20,EXAMPLE TROPHY SHOP,-80.00",
          "2027-05-01,ONLINE TRANSFER TO SAVINGS,-500.00",
          "2027-09-15,EXAMPLE TAVERN DEPOSIT,-200.00",
        ].join("\n"),
      );
      if (!read.ok) throw new Error(read.error);
      const preview = await previewStatement(db, {
        leagueId: w.leagueId,
        rows: read.value.rows,
        season: w.season,
      });
      // The season runs April 5 to June 28: 120 days before is December 6.
      expect(preview.map((r) => r.status)).toEqual([
        "outside_season",
        "new",
        "transfer",
        "outside_season",
      ]);
    });
  });
});

describe("ref pay and the pay sheet", () => {
  it("leaves game-day ref pay to the pay sheet, whose payouts never wait on a receipt", async () => {
    await inRolledBackDb(async (db) => {
      const w = await booksWorld(db);
      const ref = await addRecurringCost(
        db,
        {
          leagueId: w.leagueId,
          label: "Ref pay",
          category: "refs",
          amountCents: 12000,
          cadence: "game_day",
          startsOn: "2027-01-01",
        },
        w.owner,
      );
      const at = {
        leagueId: w.leagueId,
        season: w.season,
        timeZone: TZ,
        today: "2027-04-30",
      };
      const sheet = { leagueId: w.leagueId, seasonId: w.season.id };
      expect((await seasonExpected(db, at)).due).toHaveLength(2);
      expect(await refPaySummary(db, sheet)).toBeNull();

      // The admins set a per-game fee on the pay sheet.
      await db
        .insert(refereePayRate)
        .values({ seasonId: w.season.id, feeCents: 4000 });
      expect((await seasonExpected(db, at)).due).toEqual([]);
      expect(
        await confirmExpected(
          db,
          {
            ...at,
            costId: ref,
            dueOn: "2027-04-10",
            amountCents: 12000,
            paidBy: null,
          },
          w.owner,
        ),
      ).toEqual({ ok: false, error: "not_expected" });
      expect(await refPaySummary(db, sheet)).toMatchObject({
        feeCents: 4000,
        gamesWorked: 0,
        balanceCents: 0,
      });

      // A payout marked on the sheet writes a Refs expense; it isn't
      // waiting on a receipt, and a typed expense still is.
      const payout = await w.add(4000, { category: "refs" });
      if (!payout.ok) throw new Error(payout.error);
      await db.insert(refereePayout).values({
        seasonId: w.season.id,
        userId: w.teammate,
        amountCents: 4000,
        method: "venmo",
        paidOn: "2027-04-12",
        expenseId: payout.value,
      });
      await w.add(2500, { category: "shirts" });
      expect(await lastCategory(db, w.leagueId)).toBe("shirts");
      expect(
        await queueBooksNudge(db, {
          leagueId: w.leagueId,
          timeZone: TZ,
          today: "2027-05-01",
          now: new Date("2027-05-01T14:00:00Z"),
        }),
      ).toBe(1);
      const [sent] = await db
        .select({ payload: message.payload })
        .from(message)
        .where(
          and(eq(message.userId, w.owner), eq(message.template, "books_nudge")),
        );
      expect(sent?.payload).toMatchObject({
        receiptsCount: 1,
        receipts: [{ amountCents: 2500 }],
      });
    });
  });
});

describe("the monthly nudge", () => {
  it("goes to each owner once a month, in the first week, when something is waiting", async () => {
    await inRolledBackDb(async (db) => {
      const w = await booksWorld(db);
      const nudge = (today: string) =>
        queueBooksNudge(db, {
          leagueId: w.leagueId,
          timeZone: TZ,
          today,
          now: new Date(`${today}T14:00:00Z`),
        });
      // Nothing waiting yet.
      expect(await nudge("2027-05-01")).toBe(0);

      // Neither counts as missing a receipt.
      await w.add(1000, { noReceipt: true });
      await w.add(1000, { importKey: "a".repeat(64) });
      expect(await nudge("2027-05-01")).toBe(0);

      await w.add(4200);
      expect(await nudge("2027-05-10")).toBe(0);
      expect(await nudge("2027-05-02")).toBe(1);
      expect(await nudge("2027-05-03")).toBe(0);

      const [sent] = await db
        .select({ payload: message.payload, topic: message.topic })
        .from(message)
        .where(
          and(eq(message.userId, w.owner), eq(message.template, "books_nudge")),
        );
      expect(sent?.topic).toBe("operations");
      expect(sent?.payload).toMatchObject({
        receiptsCount: 1,
        expectedCount: 0,
        receipts: [{ amountCents: 4200, category: "Equipment" }],
      });
    });
  });
});
