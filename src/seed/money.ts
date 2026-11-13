import { inArray, or, type SQL } from "drizzle-orm";
import type { Db } from "@/db/queries/schedule";
import type { SeasonId, UserId } from "@/domain/ids";
import {
  creditEntry,
  purchase,
  referral,
  savedPaymentMethod,
  seasonRebate,
  teamSeason,
  waitlistEntry,
} from "@/db/schema";

/**
 * Clears league credit, guarantee cards, rebates, referrals and waitlist
 * entries for the seasons and people a reset is about to delete, since
 * those rows would block it. Credit rows go first: they point at
 * purchases, rebates and referrals.
 */
export async function removeMoneyRecords(
  db: Db,
  {
    seasonIds = [],
    userIds = [],
  }: { seasonIds?: SeasonId[]; userIds?: UserId[] },
): Promise<void> {
  const bySeason = seasonIds.length > 0;
  const byUser = userIds.length > 0;
  if (!bySeason && !byUser) return;
  const any = (...conditions: (SQL | false)[]) =>
    or(...conditions.filter((c): c is SQL => c !== false));

  const purchases = db
    .select({ id: purchase.id })
    .from(purchase)
    .where(
      any(
        bySeason && inArray(purchase.seasonId, seasonIds),
        byUser && inArray(purchase.userId, userIds),
      ),
    );
  const referrals = db
    .select({ id: referral.id })
    .from(referral)
    .where(
      any(
        bySeason && inArray(referral.seasonId, seasonIds),
        byUser && inArray(referral.referrerUserId, userIds),
        byUser && inArray(referral.referredUserId, userIds),
      ),
    );
  const rebates = db
    .select({ id: seasonRebate.id })
    .from(seasonRebate)
    .where(inArray(seasonRebate.seasonId, seasonIds));
  const teams = db
    .select({ id: teamSeason.id })
    .from(teamSeason)
    .where(inArray(teamSeason.seasonId, seasonIds));

  await db
    .delete(creditEntry)
    .where(
      any(
        inArray(creditEntry.purchaseId, purchases),
        inArray(creditEntry.referralId, referrals),
        bySeason && inArray(creditEntry.rebateId, rebates),
        byUser && inArray(creditEntry.userId, userIds),
      ),
    );
  await db
    .delete(savedPaymentMethod)
    .where(
      any(
        inArray(savedPaymentMethod.chargePurchaseId, purchases),
        bySeason && inArray(savedPaymentMethod.teamSeasonId, teams),
        byUser && inArray(savedPaymentMethod.userId, userIds),
      ),
    );
  await db.delete(referral).where(inArray(referral.id, referrals));
  if (bySeason)
    await db
      .delete(seasonRebate)
      .where(inArray(seasonRebate.seasonId, seasonIds));
  await db
    .delete(waitlistEntry)
    .where(
      any(
        bySeason && inArray(waitlistEntry.seasonId, seasonIds),
        byUser && inArray(waitlistEntry.userId, userIds),
      ),
    );
}
