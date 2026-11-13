import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import type { PromoCodeId, SeasonId, UserId } from "@/domain/ids";
import type { NewPromo, StoredPromo } from "@/domain/registration/promo";
import { err, ok, type Result } from "@/domain/result";
import { promoCode, purchase } from "../schema/money";
import { recordAudit } from "./audit";
import type { Db } from "./schedule";

/**
 * Promo codes for a season (product-spec.md, "Promo codes"). A code counts
 * as used by every purchase that is paid, refunded or still at checkout;
 * failed and expired checkouts give the use back.
 */
const USES = ["open", "paid", "partially_refunded", "refunded"] as const;

export type PromoCodeRow = StoredPromo & {
  id: PromoCodeId;
  disabledAt: Date | null;
  createdAt: Date;
};

/** Every code for a season, oldest first, with how often each was used. */
export async function promoCodesForSeason(
  db: Db,
  seasonId: SeasonId,
): Promise<PromoCodeRow[]> {
  const rows = await db
    .select({
      id: promoCode.id,
      code: promoCode.code,
      kind: promoCode.kind,
      value: promoCode.value,
      maxRedemptions: promoCode.maxRedemptions,
      validUntil: promoCode.validUntil,
      disabledAt: promoCode.disabledAt,
      createdAt: promoCode.createdAt,
      redemptions: count(purchase.id),
    })
    .from(promoCode)
    .leftJoin(
      purchase,
      and(
        eq(purchase.promoCodeId, promoCode.id),
        inArray(purchase.status, USES),
      ),
    )
    .where(eq(promoCode.seasonId, seasonId))
    .groupBy(promoCode.id)
    .orderBy(asc(promoCode.createdAt), asc(promoCode.code));
  return rows;
}

export type CreatePromoError = "duplicate";

/** Adds a code to a season, unless the season already has it. */
export async function createPromoCode(
  db: Db,
  input: { seasonId: SeasonId; promo: NewPromo; actorId: UserId },
): Promise<Result<PromoCodeId, CreatePromoError>> {
  const [created] = await db
    .insert(promoCode)
    .values({
      seasonId: input.seasonId,
      createdBy: input.actorId,
      ...input.promo,
    })
    .onConflictDoNothing()
    .returning({ id: promoCode.id });
  if (!created) return err("duplicate");
  await recordAudit(db, {
    actorId: input.actorId,
    action: "promo_code.create",
    entityType: "promo_code",
    entityId: created.id,
    after: input.promo,
  });
  return ok(created.id);
}

/** Turns a code off; purchases that already used it keep their discount. */
export async function disablePromoCode(
  db: Db,
  input: { seasonId: SeasonId; id: PromoCodeId; actorId: UserId; now: Date },
): Promise<boolean> {
  const [changed] = await db
    .update(promoCode)
    .set({ disabledAt: input.now })
    .where(
      and(
        eq(promoCode.id, input.id),
        eq(promoCode.seasonId, input.seasonId),
        isNull(promoCode.disabledAt),
      ),
    )
    .returning({ code: promoCode.code });
  if (!changed) return false;
  await recordAudit(db, {
    actorId: input.actorId,
    action: "promo_code.disable",
    entityType: "promo_code",
    entityId: input.id,
    after: { code: changed.code, disabledAt: input.now },
  });
  return true;
}

/**
 * A live code for checkout, locked until the transaction ends so two people
 * cannot both take its last use. Null when the season has no such code or it
 * was turned off.
 */
export async function promoForCheckout(
  db: Db,
  seasonId: SeasonId,
  code: string,
): Promise<(StoredPromo & { id: PromoCodeId }) | null> {
  const [found] = await db
    .select({
      id: promoCode.id,
      code: promoCode.code,
      kind: promoCode.kind,
      value: promoCode.value,
      maxRedemptions: promoCode.maxRedemptions,
      validUntil: promoCode.validUntil,
    })
    .from(promoCode)
    .where(
      and(
        eq(promoCode.seasonId, seasonId),
        eq(promoCode.code, code),
        isNull(promoCode.disabledAt),
      ),
    )
    .for("update");
  if (!found) return null;
  const [used] = await db
    .select({ n: count() })
    .from(purchase)
    .where(
      and(eq(purchase.promoCodeId, found.id), inArray(purchase.status, USES)),
    );
  return { ...found, redemptions: used?.n ?? 0 };
}
