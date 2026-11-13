import { and, desc, eq, inArray, sql, sum } from "drizzle-orm";
import type { PurchaseId, UserId } from "@/domain/ids";
import type { Goodwill } from "@/domain/money/credit";
import { err, ok, type Result } from "@/domain/result";
import { user } from "../schema/auth";
import { creditEntry } from "../schema/credit";
import { purchase } from "../schema/money";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { recordAudit } from "./audit";
import type { Db } from "./schedule";

/**
 * The league credit ledger (docs/data-model.md, section 2.3). Append-only:
 * nothing here updates or deletes a row. A balance is the sum of a person's
 * rows.
 */

export async function creditBalance(db: Db, userId: UserId): Promise<number> {
  const [row] = await db
    .select({ total: sum(creditEntry.deltaCents).mapWith(Number) })
    .from(creditEntry)
    .where(eq(creditEntry.userId, userId));
  return row?.total ?? 0;
}

/**
 * Locks a person's ledger for the rest of the transaction, so two checkouts
 * at once cannot both spend the same credit. Locks their user row, which
 * nothing else locks for long.
 */
export async function lockCredit(db: Db, userId: UserId): Promise<void> {
  await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, userId))
    .for("update");
}

/** Records credit used at checkout. Call after lockCredit, in one transaction. */
export async function spendCredit(
  db: Db,
  input: { userId: UserId; purchaseId: PurchaseId; cents: number },
): Promise<void> {
  if (input.cents <= 0) return;
  await db.insert(creditEntry).values({
    userId: input.userId,
    deltaCents: -input.cents,
    reason: "spent",
    purchaseId: input.purchaseId,
  });
}

/**
 * Gives back the credit an unfinished checkout held, with a matching
 * `released` row. Only for purchases that ended without being paid; safe to
 * call twice, since a purchase is released at most once.
 */
export async function releaseCredit(
  db: Db,
  purchaseIds: readonly PurchaseId[],
): Promise<void> {
  if (purchaseIds.length === 0) return;
  const spent = await db
    .select({
      userId: creditEntry.userId,
      purchaseId: creditEntry.purchaseId,
      deltaCents: creditEntry.deltaCents,
    })
    .from(creditEntry)
    .innerJoin(purchase, eq(creditEntry.purchaseId, purchase.id))
    .where(
      and(
        inArray(creditEntry.purchaseId, [...purchaseIds]),
        eq(creditEntry.reason, "spent"),
        inArray(purchase.status, ["expired", "failed"]),
      ),
    );
  if (spent.length === 0) return;
  await db
    .insert(creditEntry)
    .values(
      spent.map((s) => ({
        userId: s.userId,
        deltaCents: -s.deltaCents,
        reason: "released" as const,
        purchaseId: s.purchaseId,
      })),
    )
    .onConflictDoNothing();
}

/** A person's ledger, newest first, for their account page. */
export async function creditHistory(db: Db, userId: UserId, limit = 50) {
  return db
    .select({
      id: creditEntry.id,
      deltaCents: creditEntry.deltaCents,
      reason: creditEntry.reason,
      note: creditEntry.note,
      createdAt: creditEntry.createdAt,
      seasonName: season.name,
    })
    .from(creditEntry)
    .leftJoin(purchase, eq(creditEntry.purchaseId, purchase.id))
    .leftJoin(season, eq(purchase.seasonId, season.id))
    .where(eq(creditEntry.userId, userId))
    .orderBy(desc(creditEntry.createdAt), desc(creditEntry.id))
    .limit(limit);
}

export type GoodwillError = "unknown_player";

/** An admin gives a player credit, with a note the player sees. */
export async function grantGoodwill(
  db: Db,
  input: Goodwill & { actorId: UserId },
): Promise<Result<UserId, GoodwillError>> {
  const [person] = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = ${input.email}`);
  if (!person) return err("unknown_player");
  const [created] = await db
    .insert(creditEntry)
    .values({
      userId: person.id,
      deltaCents: input.cents,
      reason: "goodwill",
      note: input.note,
      issuedBy: input.actorId,
    })
    .returning({ id: creditEntry.id });
  await recordAudit(db, {
    actorId: input.actorId,
    action: "credit.goodwill",
    entityType: "user",
    entityId: person.id,
    after: { creditEntryId: created?.id, cents: input.cents, note: input.note },
  });
  return ok(person.id);
}

/**
 * The admin's view of the ledger: everyone holding credit, largest balance
 * first, and the latest grants.
 */
export async function creditOverview(db: Db, limit = 30) {
  const name = sql<string>`coalesce(nullif(trim(concat_ws(' ', ${profile.firstName}, ${profile.lastName})), ''), ${user.name})`;
  const balance = sum(creditEntry.deltaCents).mapWith(Number);
  const [holders, recent] = await Promise.all([
    db
      .select({ userId: user.id, name, email: user.email, balance })
      .from(creditEntry)
      .innerJoin(user, eq(creditEntry.userId, user.id))
      .leftJoin(profile, eq(profile.userId, user.id))
      .groupBy(user.id, profile.firstName, profile.lastName)
      .having(sql`sum(${creditEntry.deltaCents}) > 0`)
      .orderBy(desc(balance), user.email)
      .limit(limit),
    db
      .select({
        id: creditEntry.id,
        name,
        deltaCents: creditEntry.deltaCents,
        reason: creditEntry.reason,
        note: creditEntry.note,
        createdAt: creditEntry.createdAt,
      })
      .from(creditEntry)
      .innerJoin(user, eq(creditEntry.userId, user.id))
      .leftJoin(profile, eq(profile.userId, user.id))
      .where(
        inArray(creditEntry.reason, ["goodwill", "rainout_rebate", "referral"]),
      )
      .orderBy(desc(creditEntry.createdAt), desc(creditEntry.id))
      .limit(limit),
  ]);
  return { holders, recent };
}
