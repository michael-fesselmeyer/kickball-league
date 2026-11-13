import {
  aliasedTable,
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { checkFits, type FileProblem } from "@/domain/books/files";
import {
  buildLedger,
  type ExpenseCategory,
  type Ledger,
  type PaymentMethod,
  splitCost,
} from "@/domain/books/ledger";
import {
  type Deadline,
  reminderKey,
  remindersDue,
} from "@/domain/books/reminders";
import type {
  BooksFileId,
  ExpenseId,
  GameId,
  InsuranceCertificateId,
  LeagueId,
  PermitWindowId,
  SeasonId,
  UserId,
} from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import type { BooksReminderPayload } from "@/emails/books-reminder";
import type { PreparedFile } from "@/lib/books/store-file";
import {
  booksFile,
  type BooksFileKind,
  expense,
  insuranceCertificate,
} from "../schema/books";
import { field, game, slot, venue } from "../schema/game";
import { league } from "../schema/league";
import { payment, purchase } from "../schema/money";
import { profile } from "../schema/profile";
import { blackout, permitWindow } from "../schema/schedule";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import { recordAudit } from "./audit";
import { enqueueMessages } from "./outbox";
import { required } from "./rows";
import type { Db } from "./schedule";

/**
 * The owners' books and permit helper (ADR 0034; docs/data-model.md,
 * section 2.9). Pages check `books.manage` before calling anything here;
 * the permit at the field checks `permit.view_at_field`. Every change is
 * audited as `books.*`, which the audit log shows to owners only.
 */

// ---------------------------------------------------------------------------
// Stored files

/** Bytes of every stored books file, the figure the total cap limits. */
export async function storedBytes(db: Db, leagueId: LeagueId): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${booksFile.byteSize}), 0)` })
    .from(booksFile)
    .where(eq(booksFile.leagueId, leagueId));
  return Number(row?.total ?? 0);
}

/**
 * Stores a prepared file if it fits under the cap. Call inside the
 * transaction that uses it; a lock on the league's files makes two uploads
 * at once count each other.
 */
export async function storeFile(
  db: Db,
  input: {
    leagueId: LeagueId;
    kind: BooksFileKind;
    file: PreparedFile;
    cap?: number | undefined;
  },
  actorId: UserId,
): Promise<Result<BooksFileId, FileProblem>> {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`books_file:${input.leagueId}`}))`,
  );
  const used = await storedBytes(db, input.leagueId);
  const problem = checkFits(input.file.bytes.length, used, input.cap);
  if (problem) return err(problem);
  const [created] = await db
    .insert(booksFile)
    .values({
      leagueId: input.leagueId,
      kind: input.kind,
      contentType: input.file.contentType,
      bytes: input.file.bytes,
      byteSize: input.file.bytes.length,
      sha256: input.file.sha256,
      createdBy: actorId,
    })
    .returning({ id: booksFile.id });
  const id = required(created, "books file").id;
  await recordAudit(db, {
    actorId,
    action: "books.file_add",
    entityType: "books_file",
    entityId: id,
    after: { kind: input.kind, bytes: input.file.bytes.length },
  });
  return ok(id);
}

/** A stored file of the league, for the owners' private route. */
export async function booksFileOf(
  db: Db,
  leagueId: LeagueId,
  fileId: BooksFileId,
) {
  const [found] = await db
    .select({
      contentType: booksFile.contentType,
      bytes: booksFile.bytes,
      sha256: booksFile.sha256,
      kind: booksFile.kind,
    })
    .from(booksFile)
    .where(and(eq(booksFile.id, fileId), eq(booksFile.leagueId, leagueId)));
  return found ?? null;
}

/** Deletes files nothing refers to any more. */
async function dropUnusedFiles(db: Db, ids: readonly BooksFileId[]) {
  if (ids.length === 0) return;
  await db
    .delete(booksFile)
    .where(
      and(
        inArray(booksFile.id, [...ids]),
        sql`not exists (select 1 from ${expense} where ${expense.receiptFileId} = ${booksFile.id})`,
        sql`not exists (select 1 from ${permitWindow} where ${permitWindow.documentFileId} = ${booksFile.id})`,
        sql`not exists (select 1 from ${insuranceCertificate} where ${insuranceCertificate.documentFileId} = ${booksFile.id})`,
      ),
    );
}

// ---------------------------------------------------------------------------
// Expenses

export type ExpenseInput = {
  leagueId: LeagueId;
  seasonId: SeasonId;
  spentOn: string;
  amountCents: number;
  category: ExpenseCategory;
  note: string;
  receipt: PreparedFile | null;
  /** Tests pass a smaller storage cap. */
  cap?: number;
};

export async function addExpense(
  db: Db,
  input: ExpenseInput,
  actorId: UserId,
): Promise<Result<ExpenseId, FileProblem | "unknown_season">> {
  if (!(await seasonInLeague(db, input.leagueId, input.seasonId)))
    return err("unknown_season");
  let receiptFileId: BooksFileId | null = null;
  if (input.receipt) {
    const stored = await storeFile(
      db,
      {
        leagueId: input.leagueId,
        kind: "receipt",
        file: input.receipt,
        cap: input.cap,
      },
      actorId,
    );
    if (!stored.ok) return stored;
    receiptFileId = stored.value;
  }
  const [created] = await db
    .insert(expense)
    .values({
      seasonId: input.seasonId,
      spentOn: input.spentOn,
      amountCents: input.amountCents,
      category: input.category,
      note: input.note.trim() || null,
      receiptFileId,
      createdBy: actorId,
    })
    .returning({ id: expense.id });
  const id = required(created, "expense").id;
  await recordAudit(db, {
    actorId,
    action: "books.expense_add",
    entityType: "expense",
    entityId: id,
    after: {
      seasonId: input.seasonId,
      spentOn: input.spentOn,
      amountCents: input.amountCents,
      category: input.category,
      receipt: receiptFileId !== null,
    },
  });
  return ok(id);
}

export async function removeExpense(
  db: Db,
  input: { leagueId: LeagueId; expenseId: ExpenseId },
  actorId: UserId,
): Promise<Result<void, "unknown_expense">> {
  const [found] = await db
    .select({
      seasonId: expense.seasonId,
      spentOn: expense.spentOn,
      amountCents: expense.amountCents,
      category: expense.category,
      receiptFileId: expense.receiptFileId,
    })
    .from(expense)
    .innerJoin(season, eq(season.id, expense.seasonId))
    .where(
      and(eq(expense.id, input.expenseId), eq(season.leagueId, input.leagueId)),
    );
  if (!found) return err("unknown_expense");
  await db.delete(expense).where(eq(expense.id, input.expenseId));
  if (found.receiptFileId) await dropUnusedFiles(db, [found.receiptFileId]);
  await recordAudit(db, {
    actorId,
    action: "books.expense_remove",
    entityType: "expense",
    entityId: input.expenseId,
    before: found,
  });
  return ok(undefined);
}

async function seasonInLeague(db: Db, leagueId: LeagueId, seasonId: SeasonId) {
  const [found] = await db
    .select({ id: season.id })
    .from(season)
    .where(and(eq(season.id, seasonId), eq(season.leagueId, leagueId)));
  return found !== undefined;
}

// ---------------------------------------------------------------------------
// The ledger

type SeasonRef = { id: SeasonId; startsOn: string; endsOn: string };

/**
 * Payments that count toward a season: those for its purchases, and those
 * for purchases with no season (event tickets, merch) paid on a day the
 * season was running, in the league's time zone.
 */
function paymentsOfSeason(db: Db, s: SeasonRef) {
  const day = sql`(${payment.paidAt} at time zone ${league.timezone})::date`;
  return db
    .select({
      id: payment.id,
      method: payment.method,
      amountCents: payment.amountCents,
      refundedCents: payment.refundedCents,
      paidAt: payment.paidAt,
      createdAt: payment.createdAt,
      creditAppliedCents: purchase.creditAppliedCents,
      purchaseId: purchase.id,
      kinds: sql<
        string[]
      >`(select array_agg(distinct pi.kind::text order by pi.kind::text) from purchase_item pi where pi.purchase_id = ${purchase.id})`,
    })
    .from(payment)
    .innerJoin(purchase, eq(purchase.id, payment.purchaseId))
    .innerJoin(season, eq(season.id, s.id))
    .innerJoin(league, eq(league.id, season.leagueId))
    .where(
      and(
        eq(payment.status, "succeeded"),
        or(
          eq(purchase.seasonId, s.id),
          and(
            isNull(purchase.seasonId),
            sql`${day} between ${s.startsOn}::date and ${s.endsOn}::date`,
          ),
        ),
      ),
    )
    .orderBy(asc(payment.paidAt), asc(payment.id));
}

function expensesOfSeason(db: Db, seasonId: SeasonId) {
  return db
    .select({
      id: expense.id,
      spentOn: expense.spentOn,
      amountCents: expense.amountCents,
      category: expense.category,
      note: expense.note,
      receiptFileId: expense.receiptFileId,
    })
    .from(expense)
    .where(eq(expense.seasonId, seasonId))
    .orderBy(desc(expense.spentOn), desc(expense.createdAt));
}

function permitCostsOfSeason(db: Db, seasonId: SeasonId) {
  return db
    .select({
      id: permitWindow.id,
      startsAt: permitWindow.startsAt,
      costCents: permitWindow.costCents,
      permitNumber: permitWindow.permitNumber,
      fieldName: field.name,
    })
    .from(permitWindow)
    .innerJoin(field, eq(field.id, permitWindow.fieldId))
    .where(
      and(
        eq(permitWindow.seasonId, seasonId),
        isNotNull(permitWindow.costCents),
      ),
    )
    .orderBy(asc(permitWindow.startsAt));
}

export type SeasonBooks = {
  ledger: Ledger;
  expenses: Awaited<ReturnType<typeof expensesOfSeason>>;
  payments: Awaited<ReturnType<typeof paymentsOfSeason>>;
  permitCosts: Awaited<ReturnType<typeof permitCostsOfSeason>>;
};

/** Everything the ledger screen and its CSV need, in three parallel reads. */
export async function seasonBooks(db: Db, s: SeasonRef): Promise<SeasonBooks> {
  const [payments, expenses, permitCosts] = await Promise.all([
    paymentsOfSeason(db, s),
    expensesOfSeason(db, s.id),
    permitCostsOfSeason(db, s.id),
  ]);
  // Credit is counted once per purchase, however many payments it had.
  const credit = new Map(
    payments.map((p) => [p.purchaseId, p.creditAppliedCents]),
  );
  const ledger = buildLedger({
    payments: payments.map((p) => ({
      method: p.method satisfies PaymentMethod,
      amountCents: p.amountCents,
      refundedCents: p.refundedCents,
    })),
    creditAppliedCents: [...credit.values()].reduce((a, b) => a + b, 0),
    expenses,
    permitCostCents: permitCosts.map((p) => p.costCents ?? 0),
  });
  return { ledger, expenses, payments, permitCosts };
}

/** The league's seasons, newest first, for the season picker. */
export async function booksSeasons(db: Db, leagueId: LeagueId) {
  return db
    .select({
      id: season.id,
      slug: season.slug,
      name: season.name,
      startsOn: season.startsOn,
      endsOn: season.endsOn,
      status: season.status,
      leagueId: season.leagueId,
      gamesPerTeamPerDay: season.gamesPerTeamPerDay,
    })
    .from(season)
    .where(eq(season.leagueId, leagueId))
    .orderBy(desc(season.startsOn));
}

// ---------------------------------------------------------------------------
// Permits

export type PermitWindowRow = {
  id: PermitWindowId;
  fieldId: string;
  fieldName: string;
  venueName: string;
  startsAt: Date;
  endsAt: Date;
  permitNumber: string | null;
  status: "requested" | "confirmed" | "lost";
  costCents: number | null;
  documentFileId: BooksFileId | null;
  applicationOpensOn: string | null;
  applicationClosesOn: string | null;
  renewsOn: string | null;
};

export type PermitGroup = {
  /** `n:<permit number>`, or `f:<field id>` for windows without one yet. */
  key: string;
  label: string;
  windows: PermitWindowRow[];
  costCents: number | null;
  documentFileId: BooksFileId | null;
  applicationOpensOn: string | null;
  applicationClosesOn: string | null;
  renewsOn: string | null;
  lost: number;
};

export const groupKey = (w: {
  permitNumber: string | null;
  fieldId: string;
}) => (w.permitNumber ? `n:${w.permitNumber}` : `f:${w.fieldId}`);

/** The season's permit windows, grouped by permit (or by field without one). */
export async function permitGroups(
  db: Db,
  seasonId: SeasonId,
): Promise<PermitGroup[]> {
  const windows = await db
    .select({
      id: permitWindow.id,
      fieldId: permitWindow.fieldId,
      fieldName: field.name,
      venueName: venue.name,
      startsAt: permitWindow.startsAt,
      endsAt: permitWindow.endsAt,
      permitNumber: permitWindow.permitNumber,
      status: permitWindow.status,
      costCents: permitWindow.costCents,
      documentFileId: permitWindow.documentFileId,
      applicationOpensOn: permitWindow.applicationOpensOn,
      applicationClosesOn: permitWindow.applicationClosesOn,
      renewsOn: permitWindow.renewsOn,
    })
    .from(permitWindow)
    .innerJoin(field, eq(field.id, permitWindow.fieldId))
    .innerJoin(venue, eq(venue.id, field.venueId))
    .where(eq(permitWindow.seasonId, seasonId))
    .orderBy(asc(permitWindow.startsAt), asc(field.name));
  const groups = new Map<string, PermitWindowRow[]>();
  for (const w of windows) {
    const key = groupKey(w);
    groups.set(key, [...(groups.get(key) ?? []), w]);
  }
  return [...groups.entries()].map(([key, rows]) => {
    const first = required(rows[0], "permit window");
    const costs = rows.map((r) => r.costCents);
    return {
      key,
      label: first.permitNumber
        ? `Permit ${first.permitNumber}`
        : `${first.venueName}, ${first.fieldName} (no permit number yet)`,
      windows: rows,
      costCents: costs.every((c) => c === null)
        ? null
        : costs.reduce<number>((a, c) => a + (c ?? 0), 0),
      documentFileId: first.documentFileId,
      applicationOpensOn: first.applicationOpensOn,
      applicationClosesOn: first.applicationClosesOn,
      renewsOn: first.renewsOn,
      lost: rows.filter((r) => r.status === "lost").length,
    };
  });
}

export type PermitDetails = {
  leagueId: LeagueId;
  seasonId: SeasonId;
  key: string;
  costCents: number | null;
  /** A new document, or undefined to keep the current one. */
  document?: PreparedFile;
  applicationOpensOn: string | null;
  applicationClosesOn: string | null;
  renewsOn: string | null;
  cap?: number;
};

/**
 * Sets a permit's details on every window in its group. The cost is split
 * across the windows, earliest first, so the books add up to it.
 */
export async function setPermitDetails(
  db: Db,
  input: PermitDetails,
  actorId: UserId,
): Promise<Result<number, FileProblem | "unknown_permit" | "bad_dates">> {
  if (
    input.applicationOpensOn &&
    input.applicationClosesOn &&
    input.applicationClosesOn < input.applicationOpensOn
  )
    return err("bad_dates");
  const group = (await permitGroups(db, input.seasonId)).find(
    (g) => g.key === input.key,
  );
  if (!group || !(await seasonInLeague(db, input.leagueId, input.seasonId)))
    return err("unknown_permit");
  let documentFileId = group.documentFileId;
  if (input.document) {
    const stored = await storeFile(
      db,
      {
        leagueId: input.leagueId,
        kind: "permit",
        file: input.document,
        cap: input.cap,
      },
      actorId,
    );
    if (!stored.ok) return stored;
    documentFileId = stored.value;
  }
  const shares =
    input.costCents === null
      ? group.windows.map(() => null)
      : splitCost(input.costCents, group.windows.length);
  for (const [i, w] of group.windows.entries())
    await db
      .update(permitWindow)
      .set({
        costCents: shares[i] ?? null,
        documentFileId,
        applicationOpensOn: input.applicationOpensOn,
        applicationClosesOn: input.applicationClosesOn,
        renewsOn: input.renewsOn,
      })
      .where(eq(permitWindow.id, w.id));
  const replaced = group.windows.flatMap((w) =>
    w.documentFileId && w.documentFileId !== documentFileId
      ? [w.documentFileId]
      : [],
  );
  await dropUnusedFiles(db, [...new Set(replaced)]);
  await recordAudit(db, {
    actorId,
    action: "books.permit_details",
    entityType: "season",
    entityId: input.seasonId,
    before: {
      key: input.key,
      costCents: group.costCents,
      applicationOpensOn: group.applicationOpensOn,
      applicationClosesOn: group.applicationClosesOn,
      renewsOn: group.renewsOn,
    },
    after: {
      key: input.key,
      windows: group.windows.length,
      costCents: input.costCents,
      document: input.document !== undefined,
      applicationOpensOn: input.applicationOpensOn,
      applicationClosesOn: input.applicationClosesOn,
      renewsOn: input.renewsOn,
    },
  });
  return ok(group.windows.length);
}

const teamA = aliasedTable(team, "team_a");
const teamB = aliasedTable(team, "team_b");
const entryA = aliasedTable(teamSeason, "entry_a");
const entryB = aliasedTable(teamSeason, "entry_b");

/**
 * Games still to play on a slot cut from a permit window marked lost: the
 * ones to move on the schedule board.
 */
export async function gamesOnLostPermits(db: Db, seasonId: SeasonId) {
  return db
    .select({
      id: game.id,
      startsAt: slot.startsAt,
      fieldName: field.name,
      permitNumber: permitWindow.permitNumber,
      teamA: teamA.name,
      teamB: teamB.name,
    })
    .from(game)
    .innerJoin(slot, eq(slot.id, game.slotId))
    .innerJoin(permitWindow, eq(permitWindow.id, slot.permitWindowId))
    .innerJoin(field, eq(field.id, slot.fieldId))
    .innerJoin(entryA, eq(entryA.id, game.teamAId))
    .innerJoin(teamA, eq(teamA.id, entryA.teamId))
    .innerJoin(entryB, eq(entryB.id, game.teamBId))
    .innerJoin(teamB, eq(teamB.id, entryB.teamId))
    .where(
      and(
        eq(game.seasonId, seasonId),
        eq(permitWindow.status, "lost"),
        eq(game.status, "scheduled"),
      ),
    )
    .orderBy(asc(slot.startsAt), asc(field.name));
}

/** What the request sheet starts from: teams, league-wide blackouts, fields. */
export async function requestSheetInputs(
  db: Db,
  leagueId: LeagueId,
  seasonId: SeasonId,
) {
  const [teams, blackouts, fields] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(teamSeason)
      .where(
        and(
          eq(teamSeason.seasonId, seasonId),
          ne(teamSeason.status, "waitlisted"),
          ne(teamSeason.status, "withdrawn"),
        ),
      ),
    db
      .select({ onDate: blackout.onDate })
      .from(blackout)
      .where(and(eq(blackout.seasonId, seasonId), isNull(blackout.fieldId))),
    db
      .select({ id: field.id, name: field.name, venueName: venue.name })
      .from(field)
      .innerJoin(venue, eq(venue.id, field.venueId))
      .where(eq(venue.leagueId, leagueId))
      .orderBy(asc(venue.name), asc(field.sortOrder), asc(field.name)),
  ]);
  return {
    teams: teams[0]?.count ?? 0,
    blackouts: new Set(blackouts.map((b) => b.onDate)),
    fields,
  };
}

// ---------------------------------------------------------------------------
// Insurance

export async function insuranceCertificates(db: Db, leagueId: LeagueId) {
  return db
    .select({
      id: insuranceCertificate.id,
      insurer: insuranceCertificate.insurer,
      policyNumber: insuranceCertificate.policyNumber,
      startsOn: insuranceCertificate.startsOn,
      expiresOn: insuranceCertificate.expiresOn,
      documentFileId: insuranceCertificate.documentFileId,
    })
    .from(insuranceCertificate)
    .where(eq(insuranceCertificate.leagueId, leagueId))
    .orderBy(desc(insuranceCertificate.expiresOn));
}

export async function addInsurance(
  db: Db,
  input: {
    leagueId: LeagueId;
    insurer: string;
    policyNumber: string;
    startsOn: string;
    expiresOn: string;
    document: PreparedFile | null;
    cap?: number;
  },
  actorId: UserId,
): Promise<
  Result<InsuranceCertificateId, FileProblem | "bad_dates" | "no_insurer">
> {
  const insurer = input.insurer.trim();
  if (!insurer) return err("no_insurer");
  if (input.expiresOn <= input.startsOn) return err("bad_dates");
  let documentFileId: BooksFileId | null = null;
  if (input.document) {
    const stored = await storeFile(
      db,
      {
        leagueId: input.leagueId,
        kind: "insurance",
        file: input.document,
        cap: input.cap,
      },
      actorId,
    );
    if (!stored.ok) return stored;
    documentFileId = stored.value;
  }
  const [created] = await db
    .insert(insuranceCertificate)
    .values({
      leagueId: input.leagueId,
      insurer,
      policyNumber: input.policyNumber.trim() || null,
      startsOn: input.startsOn,
      expiresOn: input.expiresOn,
      documentFileId,
      createdBy: actorId,
    })
    .returning({ id: insuranceCertificate.id });
  const id = required(created, "insurance certificate").id;
  await recordAudit(db, {
    actorId,
    action: "books.insurance_add",
    entityType: "insurance_certificate",
    entityId: id,
    after: {
      insurer,
      startsOn: input.startsOn,
      expiresOn: input.expiresOn,
      document: documentFileId !== null,
    },
  });
  return ok(id);
}

export async function removeInsurance(
  db: Db,
  input: { leagueId: LeagueId; id: InsuranceCertificateId },
  actorId: UserId,
): Promise<Result<void, "unknown_certificate">> {
  const [found] = await db
    .delete(insuranceCertificate)
    .where(
      and(
        eq(insuranceCertificate.id, input.id),
        eq(insuranceCertificate.leagueId, input.leagueId),
      ),
    )
    .returning({
      insurer: insuranceCertificate.insurer,
      expiresOn: insuranceCertificate.expiresOn,
      documentFileId: insuranceCertificate.documentFileId,
    });
  if (!found) return err("unknown_certificate");
  if (found.documentFileId) await dropUnusedFiles(db, [found.documentFileId]);
  await recordAudit(db, {
    actorId,
    action: "books.insurance_remove",
    entityType: "insurance_certificate",
    entityId: input.id,
    before: { insurer: found.insurer, expiresOn: found.expiresOn },
  });
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// The permit at the field

/**
 * The permit a game is played on, for its ref and captains at the field.
 * Null when the game has no slot, or its slot came from no permit window.
 */
export async function fieldPermitForGame(db: Db, gameId: GameId) {
  const [found] = await db
    .select({
      gameId: game.id,
      seasonId: game.seasonId,
      teamAId: game.teamAId,
      teamBId: game.teamBId,
      permitNumber: permitWindow.permitNumber,
      status: permitWindow.status,
      windowStartsAt: permitWindow.startsAt,
      windowEndsAt: permitWindow.endsAt,
      documentFileId: permitWindow.documentFileId,
      documentType: booksFile.contentType,
      fieldName: field.name,
      venueName: venue.name,
      gameStartsAt: slot.startsAt,
      timeZone: league.timezone,
      teamA: teamA.name,
      teamB: teamB.name,
    })
    .from(game)
    .innerJoin(slot, eq(slot.id, game.slotId))
    .innerJoin(permitWindow, eq(permitWindow.id, slot.permitWindowId))
    .innerJoin(field, eq(field.id, slot.fieldId))
    .innerJoin(venue, eq(venue.id, field.venueId))
    .innerJoin(league, eq(league.id, venue.leagueId))
    .innerJoin(entryA, eq(entryA.id, game.teamAId))
    .innerJoin(teamA, eq(teamA.id, entryA.teamId))
    .innerJoin(entryB, eq(entryB.id, game.teamBId))
    .innerJoin(teamB, eq(teamB.id, entryB.teamId))
    .leftJoin(booksFile, eq(booksFile.id, permitWindow.documentFileId))
    .where(eq(game.id, gameId));
  return found ?? null;
}

/** The game's permit document, or null. */
export async function permitDocumentForGame(db: Db, gameId: GameId) {
  const [found] = await db
    .select({
      contentType: booksFile.contentType,
      bytes: booksFile.bytes,
      sha256: booksFile.sha256,
    })
    .from(game)
    .innerJoin(slot, eq(slot.id, game.slotId))
    .innerJoin(permitWindow, eq(permitWindow.id, slot.permitWindowId))
    .innerJoin(booksFile, eq(booksFile.id, permitWindow.documentFileId))
    .where(eq(game.id, gameId));
  return found ?? null;
}

// ---------------------------------------------------------------------------
// Reminders

/** The league's owners: who the books reminders go to. */
async function ownerIds(db: Db): Promise<UserId[]> {
  const rows = await db
    .select({ id: profile.userId })
    .from(profile)
    .where(eq(profile.globalRole, "owner"));
  return rows.map((r) => r.id);
}

/**
 * The permit and insurance dates still to come: each permit's application
 * opening and renewal (once per permit, not per window), and the newest
 * insurance certificate's expiry. Seasons that are over are left out.
 */
export async function booksDeadlines(
  db: Db,
  leagueId: LeagueId,
): Promise<Deadline[]> {
  const [windows, certificates] = await Promise.all([
    db
      .select({
        permitNumber: permitWindow.permitNumber,
        fieldId: permitWindow.fieldId,
        fieldName: field.name,
        seasonName: season.name,
        applicationOpensOn: permitWindow.applicationOpensOn,
        renewsOn: permitWindow.renewsOn,
      })
      .from(permitWindow)
      .innerJoin(season, eq(season.id, permitWindow.seasonId))
      .innerJoin(field, eq(field.id, permitWindow.fieldId))
      .where(
        and(
          eq(season.leagueId, leagueId),
          ne(season.status, "completed"),
          ne(permitWindow.status, "lost"),
          or(
            isNotNull(permitWindow.applicationOpensOn),
            isNotNull(permitWindow.renewsOn),
          ),
        ),
      ),
    insuranceCertificates(db, leagueId),
  ]);
  const deadlines = new Map<string, Deadline>();
  for (const w of windows) {
    const key = groupKey(w);
    const about = w.permitNumber
      ? `permit ${w.permitNumber}`
      : `the ${w.seasonName} permit for ${w.fieldName}`;
    if (w.applicationOpensOn)
      deadlines.set(`a/${key}/${w.applicationOpensOn}`, {
        kind: "application_opens",
        key,
        on: w.applicationOpensOn,
        subject: about,
      });
    if (w.renewsOn)
      deadlines.set(`r/${key}/${w.renewsOn}`, {
        kind: "permit_renews",
        key,
        on: w.renewsOn,
        subject: about,
      });
  }
  const newest = certificates[0];
  if (newest)
    deadlines.set(`i/${newest.id}`, {
      kind: "insurance_expires",
      key: newest.id,
      on: newest.expiresOn,
      subject: `the insurance certificate from ${newest.insurer}`,
    });
  return [...deadlines.values()];
}

/** Queues the reminders due today for every owner. Returns how many were new. */
export async function queueBooksReminders(
  db: Db,
  leagueId: LeagueId,
  today: string,
  now: Date,
): Promise<number> {
  const due = remindersDue(await booksDeadlines(db, leagueId), today);
  if (due.length === 0) return 0;
  const owners = await ownerIds(db);
  return enqueueMessages(
    db,
    due.flatMap((r) =>
      owners.map((userId) => ({
        userId,
        topic: "operations" as const,
        template: "books_reminder",
        payload: {
          kind: r.kind,
          subject: r.subject,
          on: r.on,
          daysLeft: r.daysLeft,
        } satisfies BooksReminderPayload,
        dedupeKey: reminderKey(r, userId),
        sendAfter: now,
      })),
    ),
  );
}

// ---------------------------------------------------------------------------
// The owners' league export

/** The books for the league export: rows and file details, never file bytes. */
export async function booksExport(db: Db, leagueId: LeagueId) {
  const [expenses, permits, insurance, files] = await Promise.all([
    db
      .select({
        id: expense.id,
        seasonId: expense.seasonId,
        spentOn: expense.spentOn,
        amountCents: expense.amountCents,
        category: expense.category,
        note: expense.note,
        receiptFileId: expense.receiptFileId,
        createdAt: expense.createdAt,
      })
      .from(expense)
      .innerJoin(season, eq(season.id, expense.seasonId))
      .where(eq(season.leagueId, leagueId))
      .orderBy(asc(expense.spentOn)),
    db
      .select({
        id: permitWindow.id,
        seasonId: permitWindow.seasonId,
        permitNumber: permitWindow.permitNumber,
        costCents: permitWindow.costCents,
        documentFileId: permitWindow.documentFileId,
        applicationOpensOn: permitWindow.applicationOpensOn,
        applicationClosesOn: permitWindow.applicationClosesOn,
        renewsOn: permitWindow.renewsOn,
      })
      .from(permitWindow)
      .innerJoin(season, eq(season.id, permitWindow.seasonId))
      .where(eq(season.leagueId, leagueId))
      .orderBy(asc(permitWindow.startsAt)),
    insuranceCertificates(db, leagueId),
    db
      .select({
        id: booksFile.id,
        kind: booksFile.kind,
        contentType: booksFile.contentType,
        byteSize: booksFile.byteSize,
        sha256: booksFile.sha256,
        createdAt: booksFile.createdAt,
      })
      .from(booksFile)
      .where(eq(booksFile.leagueId, leagueId))
      .orderBy(asc(booksFile.createdAt)),
  ]);
  return { expenses, permits, insurance, files };
}
