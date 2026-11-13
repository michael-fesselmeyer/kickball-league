import { and, count, eq, inArray, ne } from "drizzle-orm";
import type { RegistrationId, SeasonId, UserId } from "@/domain/ids";
import { REFERRAL_CREDIT_CENTS } from "@/domain/money/credit";
import { newReferralCode } from "@/domain/money/referral";
import { formatCents } from "@/domain/registration/pricing";
import type { ReferralCreditPayload } from "@/emails/money";
import { creditEntry, referral, referralCode } from "../schema/credit";
import { season } from "../schema/season";
import { registration } from "../schema/team";
import { enqueueMessages } from "./outbox";
import type { Db } from "./schedule";

/**
 * Referral credit (product-spec.md, "Referral credits"). A player shares
 * /r/<code>; a new player who arrives through it and registers is recorded
 * as referred, and the referrer gets league credit once that registration is
 * paid.
 */

/** A person's referral code, made the first time it is asked for. */
export async function referralCodeFor(db: Db, userId: UserId): Promise<string> {
  const [found] = await db
    .select({ code: referralCode.code })
    .from(referralCode)
    .where(eq(referralCode.userId, userId));
  if (found) return found.code;
  for (let attempt = 0; attempt < 5; attempt++) {
    const [created] = await db
      .insert(referralCode)
      .values({ userId, code: newReferralCode() })
      .onConflictDoNothing()
      .returning({ code: referralCode.code });
    if (created) return created.code;
    // Another request made theirs at the same moment, or the code was taken.
    const [raced] = await db
      .select({ code: referralCode.code })
      .from(referralCode)
      .where(eq(referralCode.userId, userId));
    if (raced) return raced.code;
  }
  throw new Error("Could not make a referral code");
}

/**
 * Records that a new registration came through a referral link. Only a
 * person's first registration in the league counts, nobody refers
 * themselves, and a person is referred once. Returns whether it counted.
 */
export async function recordReferral(
  db: Db,
  input: {
    code: string;
    referredUserId: UserId;
    seasonId: SeasonId;
    registrationId: RegistrationId;
  },
): Promise<boolean> {
  const [owner] = await db
    .select({ userId: referralCode.userId })
    .from(referralCode)
    .where(eq(referralCode.code, input.code));
  if (!owner || owner.userId === input.referredUserId) return false;
  const [earlier] = await db
    .select({ n: count() })
    .from(registration)
    .where(
      and(
        eq(registration.userId, input.referredUserId),
        ne(registration.id, input.registrationId),
      ),
    );
  if ((earlier?.n ?? 0) > 0) return false;
  const created = await db
    .insert(referral)
    .values({
      referrerUserId: owner.userId,
      referredUserId: input.referredUserId,
      seasonId: input.seasonId,
      registrationId: input.registrationId,
    })
    .onConflictDoNothing()
    .returning({ id: referral.id });
  return created.length > 0;
}

/**
 * Credits the referrers of registrations that were just paid for, once
 * each, and emails them. Called inside the transaction that settles the
 * payment.
 */
export async function creditReferrals(
  db: Db,
  registrationIds: readonly RegistrationId[],
  now: Date,
): Promise<number> {
  if (registrationIds.length === 0) return 0;
  const due = await db
    .update(referral)
    .set({ status: "credited", creditedAt: now })
    .where(
      and(
        inArray(referral.registrationId, [...registrationIds]),
        eq(referral.status, "pending"),
      ),
    )
    .returning({
      id: referral.id,
      referrerUserId: referral.referrerUserId,
      seasonId: referral.seasonId,
    });
  if (due.length === 0) return 0;
  await db.insert(creditEntry).values(
    due.map((r) => ({
      userId: r.referrerUserId,
      deltaCents: REFERRAL_CREDIT_CENTS,
      reason: "referral" as const,
      referralId: r.id,
    })),
  );
  const seasons = await db
    .select({ id: season.id, name: season.name })
    .from(season)
    .where(inArray(season.id, [...new Set(due.map((r) => r.seasonId))]));
  const nameOf = new Map(seasons.map((s) => [s.id, s.name]));
  await enqueueMessages(
    db,
    due.map((r) => {
      const payload: ReferralCreditPayload = {
        amount: formatCents(REFERRAL_CREDIT_CENTS),
        seasonName: nameOf.get(r.seasonId) ?? "the season",
      };
      return {
        userId: r.referrerUserId,
        topic: "payment" as const,
        template: "referral_credit",
        payload,
        dedupeKey: `referral-credit/${r.id}`,
        sendAfter: now,
      };
    }),
  );
  return due.length;
}

/** How a person's referrals are doing, for their account page. */
export async function myReferrals(db: Db, userId: UserId) {
  const rows = await db
    .select({ status: referral.status, n: count() })
    .from(referral)
    .where(eq(referral.referrerUserId, userId))
    .groupBy(referral.status);
  const of = (status: "pending" | "credited") =>
    rows.find((r) => r.status === status)?.n ?? 0;
  return { pending: of("pending"), credited: of("credited") };
}
