import { createHash } from "node:crypto";
import sharp from "sharp";
import { and, eq, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { can } from "@/domain/authz/permissions";
import { FILE_MAX_BYTES, STORED_EDGE } from "@/domain/books/files";
import { LEDGER_COLUMNS, ledgerLines } from "@/domain/books/ledger-csv";
import { toCsv } from "@/domain/export/csv";
import type { GameId, UserId } from "@/domain/ids";
import { prepareUpload, type PreparedFile } from "@/lib/books/store-file";
import { auditLog } from "../schema/audit";
import { booksFile } from "../schema/books";
import { field, game, slot, venue } from "../schema/game";
import { message } from "../schema/message";
import { profile } from "../schema/profile";
import { permitWindow } from "../schema/schedule";
import { leagueWorld } from "../test/league-world";
import {
  closePool,
  expectViolation,
  inRolledBackDb,
  inRolledBackTransaction,
  insert,
} from "../test/transaction";
import { auditLogPage } from "./audit";
import {
  addExpense,
  addInsurance,
  booksExport,
  fieldPermitForGame,
  gamesOnLostPermits,
  permitDocumentForGame,
  permitGroups,
  queueBooksReminders,
  removeExpense,
  seasonBooks,
  setPermitDetails,
  storedBytes,
} from "./books";
import type { Db } from "./schedule";
import { loadSubject } from "./subject";

afterAll(closePool);

const fakeFile = (size: number): PreparedFile => {
  const bytes = Buffer.alloc(size, 7);
  return {
    contentType: "image/webp",
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
};

const pdf = (text: string): Blob =>
  new Blob([`%PDF-1.4\n${text}\n%%EOF`], { type: "application/pdf" });

/** A season with a field, two permit windows under one permit and a game on the first. */
async function permitWorld(db: Db) {
  const w = await leagueWorld(db);
  const [v] = await db
    .insert(venue)
    .values({
      leagueId: w.leagueId,
      name: "Example Park",
      slug: "example-park",
    })
    .returning({ id: venue.id });
  if (!v) throw new Error("no venue");
  const [f] = await db
    .insert(field)
    .values({ venueId: v.id, name: "Field 2" })
    .returning({ id: field.id });
  if (!f) throw new Error("no field");
  const windows = await db
    .insert(permitWindow)
    .values(
      ["2027-04-10", "2027-04-17"].map((d) => ({
        fieldId: f.id,
        seasonId: w.season.id,
        startsAt: new Date(`${d}T16:00:00Z`),
        endsAt: new Date(`${d}T22:00:00Z`),
        permitNumber: "PK-0001",
        status: "confirmed" as const,
      })),
    )
    .returning({ id: permitWindow.id });
  const first = windows[0];
  if (!first) throw new Error("no window");
  const [s] = await db
    .insert(slot)
    .values({
      seasonId: w.season.id,
      fieldId: f.id,
      permitWindowId: first.id,
      startsAt: new Date("2027-04-10T16:00:00Z"),
      endsAt: new Date("2027-04-10T17:00:00Z"),
      timeIndex: 0,
    })
    .returning({ id: slot.id });
  if (!s) throw new Error("no slot");
  const [g] = await db
    .insert(game)
    .values({
      seasonId: w.season.id,
      teamAId: w.teamSeasonId,
      teamBId: w.otherTeamSeasonId,
      slotId: s.id,
    })
    .returning({ id: game.id });
  if (!g) throw new Error("no game");
  return { ...w, windows, gameId: g.id as GameId };
}

async function makeOwner(db: Db, userId: UserId) {
  await db
    .update(profile)
    .set({ globalRole: "owner" })
    .where(eq(profile.userId, userId));
}

describe("the ledger", () => {
  it("adds money in, expenses by category with permit costs, and the net", async () => {
    await inRolledBackDb(async (db) => {
      const w = await permitWorld(db);
      const owner = w.captain;
      for (const [amountCents, category, note] of [
        [12_999, "equipment", "Six balls"],
        [40_000, "shirts", "=SUM(A1:A9)"],
      ] as const) {
        const added = await addExpense(
          db,
          {
            leagueId: w.leagueId,
            seasonId: w.season.id,
            spentOn: "2027-03-01",
            amountCents,
            category,
            note,
            receipt: null,
          },
          owner,
        );
        expect(added.ok).toBe(true);
      }
      const saved = await setPermitDetails(
        db,
        {
          leagueId: w.leagueId,
          seasonId: w.season.id,
          key: "n:PK-0001",
          costCents: 25_001,
          applicationOpensOn: "2027-01-02",
          applicationClosesOn: "2027-01-30",
          renewsOn: "2027-07-01",
        },
        owner,
      );
      expect(saved).toEqual({ ok: true, value: 2 });

      const books = await seasonBooks(db, {
        id: w.season.id,
        startsOn: "2027-04-05",
        endsOn: "2027-06-28",
      });
      // The teammate's cash from the world.
      expect(books.ledger.income).toMatchObject({
        inAppCents: 0,
        offAppCents: 4500,
        refundsCents: 0,
        totalCents: 4500,
      });
      expect(books.permitCosts.map((p) => p.costCents)).toEqual([
        12_501, 12_500,
      ]);
      const by = Object.fromEntries(
        books.ledger.expenses.map((e) => [e.category, e.cents]),
      );
      expect(by.fields_permits).toBe(25_001);
      expect(by.equipment).toBe(12_999);
      expect(by.shirts).toBe(40_000);
      expect(books.ledger.netCents).toBe(4500 - 25_001 - 12_999 - 40_000);

      const csv = toCsv(LEDGER_COLUMNS, ledgerLines(books, "America/New_York"));
      expect(csv).toContain(",'=SUM(A1:A9),-400,no");
      expect(csv).toContain(
        '"Permit PK-0001, Field 2 (this date\'s share)",-125.01,',
      );
      expect(csv).toContain(",Six balls,-129.99,no");
      expect(csv).not.toContain("Kicker");
    });
  });
});

describe("stored files", () => {
  it("shrinks a phone photo to one small WebP without its metadata", async () => {
    const photo = await sharp({
      create: { width: 4000, height: 3000, channels: 3, background: "#c33" },
    })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: "Example" } } })
      .toBuffer();
    const prepared = await prepareUpload(
      new Blob([photo], { type: "image/jpeg" }),
    );
    if (!prepared.ok) throw new Error(prepared.error);
    expect(prepared.value.contentType).toBe("image/webp");
    const meta = await sharp(prepared.value.bytes).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(STORED_EDGE);
    expect(meta.exif).toBeUndefined();
    expect(prepared.value.bytes.length).toBeLessThan(FILE_MAX_BYTES);
  });

  it("keeps a small PDF as it is and refuses what isn't a photo or PDF", async () => {
    const kept = await prepareUpload(pdf("permit"));
    expect(kept.ok && kept.value.contentType).toBe("application/pdf");
    const big = await prepareUpload(pdf("x".repeat(FILE_MAX_BYTES)));
    expect(big).toEqual({ ok: false, error: "too_large" });
    const text = await prepareUpload(
      new Blob(["just text"], { type: "text/plain" }),
    );
    expect(text).toEqual({ ok: false, error: "not_supported" });
  });

  it("refuses a file past the total cap, with nothing stored", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const input = {
        leagueId: w.leagueId,
        seasonId: w.season.id,
        spentOn: "2027-03-01",
        amountCents: 500,
        category: "other" as const,
        note: "",
        cap: 1500,
      };
      const first = await addExpense(
        db,
        { ...input, receipt: fakeFile(1000) },
        w.captain,
      );
      expect(first.ok).toBe(true);
      const second = await addExpense(
        db,
        { ...input, receipt: fakeFile(600) },
        w.captain,
      );
      expect(second).toEqual({ ok: false, error: "storage_full" });
      expect(await storedBytes(db, w.leagueId)).toBe(1000);

      // Removing the expense frees its receipt's space.
      if (!first.ok) throw new Error("no expense");
      await removeExpense(
        db,
        { leagueId: w.leagueId, expenseId: first.value },
        w.captain,
      );
      expect(await storedBytes(db, w.leagueId)).toBe(0);
    });
  });

  it("refuses a stored file over 1 MB or of another type in the database", async () => {
    await inRolledBackTransaction(async (sql) => {
      const [lg] = await sql(
        "insert into league (name, slug) values ('Cap League', 'cap-league') returning id",
      );
      const row = (size: number, type = "image/webp") => ({
        league_id: lg?.id,
        kind: "receipt",
        content_type: type,
        bytes: Buffer.alloc(size, 1),
        byte_size: size,
        sha256: "x",
      });
      await insert(sql, "books_file", row(FILE_MAX_BYTES));
      await expectViolation(sql, "books_file_size", () =>
        insert(sql, "books_file", row(FILE_MAX_BYTES + 1)),
      );
      await expectViolation(sql, "books_file_type", () =>
        insert(sql, "books_file", row(10, "text/html")),
      );
    });
  });
});

describe("who sees the books", () => {
  it("lets an owner in and keeps an admin out, of the books and their audit rows", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      await makeOwner(db, w.captain);
      await addExpense(
        db,
        {
          leagueId: w.leagueId,
          seasonId: w.season.id,
          spentOn: "2027-03-01",
          amountCents: 999,
          category: "refs",
          note: "",
          receipt: null,
        },
        w.captain,
      );
      const admin = await loadSubject(db, w.admin);
      const owner = await loadSubject(db, w.captain);
      expect(admin.globalRole).toBe("admin");
      expect(can(admin, "books.manage")).toBe(false);
      expect(can(owner, "books.manage")).toBe(true);

      const hidden = await auditLogPage(db, { limit: 200 });
      expect(hidden.rows.some((r) => r.action.startsWith("books."))).toBe(
        false,
      );
      const shown = await auditLogPage(db, { limit: 200, withBooks: true });
      expect(shown.rows.map((r) => r.action)).toContain("books.expense_add");
    });
  });
});

describe("permits", () => {
  it("shows the permit at the field and flags games once it is lost", async () => {
    await inRolledBackDb(async (db) => {
      const w = await permitWorld(db);
      const document = await prepareUpload(pdf("PK-0001"));
      if (!document.ok) throw new Error(document.error);
      await setPermitDetails(
        db,
        {
          leagueId: w.leagueId,
          seasonId: w.season.id,
          key: "n:PK-0001",
          costCents: null,
          document: document.value,
          applicationOpensOn: null,
          applicationClosesOn: null,
          renewsOn: null,
        },
        w.captain,
      );
      const permit = await fieldPermitForGame(db, w.gameId);
      expect(permit).toMatchObject({
        permitNumber: "PK-0001",
        fieldName: "Field 2",
        documentType: "application/pdf",
        teamA: "Kick Bottom",
        teamB: "Base Invaders",
      });
      const file = await permitDocumentForGame(db, w.gameId);
      expect(file?.bytes.toString()).toContain("PK-0001");

      // The ref and both captains may see it; a teammate and an admin not.
      const ctx = {
        game: {
          id: w.gameId,
          teamSeasonIds: [w.teamSeasonId, w.otherTeamSeasonId] as const,
        },
      };
      const who = await Promise.all(
        [w.captain, w.otherCaptain, w.teammate, w.admin].map(async (id) =>
          can(await loadSubject(db, id), "permit.view_at_field", ctx),
        ),
      );
      expect(who).toEqual([true, true, false, false]);

      expect(await gamesOnLostPermits(db, w.season.id)).toEqual([]);
      const [first] = w.windows;
      if (!first) throw new Error("no window");
      await db
        .update(permitWindow)
        .set({ status: "lost" })
        .where(eq(permitWindow.id, first.id));
      const lost = await gamesOnLostPermits(db, w.season.id);
      expect(lost.map((g) => [g.id, g.teamA, g.permitNumber])).toEqual([
        [w.gameId, "Kick Bottom", "PK-0001"],
      ]);
      const [group] = await permitGroups(db, w.season.id);
      expect(group?.lost).toBe(1);
    });
  });

  it("replaces a permit's document and deletes the old one", async () => {
    await inRolledBackDb(async (db) => {
      const w = await permitWorld(db);
      const details = {
        leagueId: w.leagueId,
        seasonId: w.season.id,
        key: "n:PK-0001",
        costCents: null,
        applicationOpensOn: null,
        applicationClosesOn: null,
        renewsOn: null,
      };
      await setPermitDetails(
        db,
        { ...details, document: fakeFile(300) },
        w.captain,
      );
      await setPermitDetails(
        db,
        { ...details, document: fakeFile(200) },
        w.captain,
      );
      expect(await storedBytes(db, w.leagueId)).toBe(200);
      expect(
        await setPermitDetails(
          db,
          {
            ...details,
            applicationOpensOn: "2027-02-01",
            applicationClosesOn: "2027-01-01",
          },
          w.captain,
        ),
      ).toEqual({ ok: false, error: "bad_dates" });
    });
  });
});

describe("reminders", () => {
  it("emails each owner once per milestone before renewals and insurance expiry", async () => {
    await inRolledBackDb(async (db) => {
      const w = await permitWorld(db);
      await makeOwner(db, w.captain);
      await setPermitDetails(
        db,
        {
          leagueId: w.leagueId,
          seasonId: w.season.id,
          key: "n:PK-0001",
          costCents: null,
          applicationOpensOn: null,
          applicationClosesOn: null,
          renewsOn: "2027-07-01",
        },
        w.captain,
      );
      await addInsurance(
        db,
        {
          leagueId: w.leagueId,
          insurer: "Example Mutual",
          policyNumber: "GL-000",
          startsOn: "2026-07-10",
          expiresOn: "2027-07-10",
          document: null,
        },
        w.captain,
      );
      const now = new Date("2027-06-05T15:00:00Z");
      const mine = () =>
        db
          .select({ key: message.dedupeKey, payload: message.payload })
          .from(message)
          .where(
            and(
              eq(message.userId, w.captain),
              eq(message.template, "books_reminder"),
            ),
          );
      // 26 days before the renewal and 35 before the insurance: only one.
      expect(await queueBooksReminders(db, w.leagueId, "2027-06-05", now)).toBe(
        1,
      );
      expect(await queueBooksReminders(db, w.leagueId, "2027-06-05", now)).toBe(
        0,
      );
      expect((await mine()).map((m) => m.payload)).toEqual([
        {
          kind: "permit_renews",
          subject: "permit PK-0001",
          on: "2027-07-01",
          daysLeft: 26,
        },
      ]);
      // Later, the renewal's 7-day reminder and the insurance's 30-day one.
      await queueBooksReminders(db, w.leagueId, "2027-06-25", now);
      expect((await mine()).map((m) => m.key).sort()).toEqual(
        [
          `books-reminder/permit_renews/n:PK-0001/2027-07-01/30/${w.captain}`,
          `books-reminder/permit_renews/n:PK-0001/2027-07-01/7/${w.captain}`,
          expect.stringMatching(
            /^books-reminder\/insurance_expires\/.+\/2027-07-10\/30\//,
          ),
        ].sort(),
      );
      // Nobody but owners is emailed.
      const others = await db
        .select({ id: message.id })
        .from(message)
        .where(
          and(
            eq(message.template, "books_reminder"),
            like(message.dedupeKey, `%/${w.admin}`),
          ),
        );
      expect(others).toEqual([]);
    });
  });
});

describe("the owners' export", () => {
  it("lists the books and file details, never the file bytes", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      await addExpense(
        db,
        {
          leagueId: w.leagueId,
          seasonId: w.season.id,
          spentOn: "2027-03-01",
          amountCents: 1234,
          category: "events",
          note: "Bowling lanes",
          receipt: fakeFile(50),
        },
        w.captain,
      );
      const exported = await booksExport(db, w.leagueId);
      expect(exported.expenses).toMatchObject([
        { amountCents: 1234, category: "events", note: "Bowling lanes" },
      ]);
      expect(exported.files).toMatchObject([{ kind: "receipt", byteSize: 50 }]);
      expect(JSON.stringify(exported)).not.toContain('"bytes"');
      const audited = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(like(auditLog.action, "books.%"));
      expect(audited.map((a) => a.action).sort()).toEqual([
        "books.expense_add",
        "books.file_add",
      ]);
      const [stored] = await db
        .select({ id: booksFile.id })
        .from(booksFile)
        .where(eq(booksFile.leagueId, w.leagueId));
      expect(stored).toBeDefined();
    });
  });
});
