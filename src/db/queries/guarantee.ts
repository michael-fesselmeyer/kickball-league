import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { PurchaseId, TeamSeasonId, UserId } from "@/domain/ids";
import { formatMoment } from "@/domain/money/credit";
import { chargeTime, guaranteeStep } from "@/domain/money/guarantee";
import { formatCents } from "@/domain/registration/pricing";
import type {
  GuaranteeFailedPayload,
  GuaranteeWarningPayload,
} from "@/emails/money";
import { savedPaymentMethod } from "../schema/guarantee";
import { league } from "../schema/league";
import { purchase, purchaseItem } from "../schema/money";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import { recordAudit } from "./audit";
import { enqueueMessages } from "./outbox";
import type { Db } from "./schedule";
import { teamBalances } from "./team-balance";

/**
 * The captain guarantee (product-spec.md, "Captain guarantee"; ADR on the
 * guarantee charge). Saving and removing the card, the daily warning and
 * deadline charge, and what happens when Stripe answers.
 */

/** "Visa ending 4242", or "card" when Stripe did not say. */
export function describeCard(brand: string | null, last4: string | null) {
  const name = brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : "Card";
  return last4 ? `${name} ending ${last4}` : name.toLowerCase();
}

/** The team's live guarantee, if it has one. */
export async function teamGuarantee(db: Db, teamSeasonId: TeamSeasonId) {
  const [found] = await db
    .select({
      id: savedPaymentMethod.id,
      userId: savedPaymentMethod.userId,
      brand: savedPaymentMethod.brand,
      last4: savedPaymentMethod.last4,
      warnedAt: savedPaymentMethod.warnedAt,
      warnedForDeadline: savedPaymentMethod.warnedForDeadline,
      chargePurchaseId: savedPaymentMethod.chargePurchaseId,
      chargeStatus: purchase.status,
      createdAt: savedPaymentMethod.createdAt,
    })
    .from(savedPaymentMethod)
    .leftJoin(purchase, eq(savedPaymentMethod.chargePurchaseId, purchase.id))
    .where(
      and(
        eq(savedPaymentMethod.teamSeasonId, teamSeasonId),
        isNull(savedPaymentMethod.removedAt),
      ),
    );
  return found ?? null;
}

/**
 * Saves the card a captain set up in Checkout as the team's guarantee,
 * retiring any earlier card. A replayed webhook saves nothing new.
 */
export async function saveGuarantee(
  db: Db,
  input: {
    userId: UserId;
    teamSeasonId: TeamSeasonId;
    sessionId: string;
    customerId: string;
    paymentMethodId: string;
    brand: string | null;
    last4: string | null;
    now: Date;
  },
): Promise<boolean> {
  const [seen] = await db
    .select({ id: savedPaymentMethod.id })
    .from(savedPaymentMethod)
    .where(eq(savedPaymentMethod.stripeSetupSessionId, input.sessionId));
  if (seen) return false;
  const [exists] = await db
    .select({ id: teamSeason.id })
    .from(teamSeason)
    .where(eq(teamSeason.id, input.teamSeasonId));
  if (!exists) return false;
  await db
    .update(savedPaymentMethod)
    .set({ removedAt: input.now })
    .where(
      and(
        eq(savedPaymentMethod.teamSeasonId, input.teamSeasonId),
        isNull(savedPaymentMethod.removedAt),
      ),
    );
  await db.insert(savedPaymentMethod).values({
    userId: input.userId,
    teamSeasonId: input.teamSeasonId,
    stripeCustomerId: input.customerId,
    stripePaymentMethodId: input.paymentMethodId,
    stripeSetupSessionId: input.sessionId,
    brand: input.brand,
    last4: input.last4,
    createdAt: input.now,
  });
  await recordAudit(db, {
    actorId: input.userId,
    action: "guarantee.save",
    entityType: "team_season",
    entityId: input.teamSeasonId,
    after: { brand: input.brand, last4: input.last4 },
  });
  return true;
}

/** Takes the guarantee off; the card is never charged after this. */
export async function removeGuarantee(
  db: Db,
  input: { teamSeasonId: TeamSeasonId; actorId: UserId; now: Date },
): Promise<boolean> {
  const removed = await db
    .update(savedPaymentMethod)
    .set({ removedAt: input.now })
    .where(
      and(
        eq(savedPaymentMethod.teamSeasonId, input.teamSeasonId),
        isNull(savedPaymentMethod.removedAt),
      ),
    )
    .returning({ id: savedPaymentMethod.id });
  if (removed.length === 0) return false;
  await recordAudit(db, {
    actorId: input.actorId,
    action: "guarantee.remove",
    entityType: "team_season",
    entityId: input.teamSeasonId,
  });
  return true;
}

export type GuaranteePlan = { warned: number; charges: number };

/**
 * The daily guarantee job's database half: sends each 72-hour warning that
 * is due and creates the `balance` purchase for each charge that is due.
 * Rows are locked and skipped when another run holds them, and a guarantee
 * with a charge already made is never charged again, so two runs at once
 * charge once. Call it in a transaction; then send the charges with
 * chargesToSend.
 */
export async function planGuarantees(
  db: Db,
  now: Date,
): Promise<GuaranteePlan> {
  const rows = await db
    .select({
      id: savedPaymentMethod.id,
      userId: savedPaymentMethod.userId,
      teamSeasonId: savedPaymentMethod.teamSeasonId,
      brand: savedPaymentMethod.brand,
      last4: savedPaymentMethod.last4,
      warnedAt: savedPaymentMethod.warnedAt,
      warnedForDeadline: savedPaymentMethod.warnedForDeadline,
      chargePurchaseId: savedPaymentMethod.chargePurchaseId,
      deadline: season.paymentDeadlineAt,
      seasonId: season.id,
      seasonName: season.name,
      seasonSlug: season.slug,
      teamName: team.name,
      timeZone: league.timezone,
    })
    .from(savedPaymentMethod)
    .innerJoin(teamSeason, eq(savedPaymentMethod.teamSeasonId, teamSeason.id))
    .innerJoin(team, eq(teamSeason.teamId, team.id))
    .innerJoin(season, eq(teamSeason.seasonId, season.id))
    .innerJoin(league, eq(season.leagueId, league.id))
    .where(
      and(
        isNull(savedPaymentMethod.removedAt),
        isNull(savedPaymentMethod.chargePurchaseId),
        isNotNull(season.paymentDeadlineAt),
        inArray(teamSeason.status, ["forming", "pending_payment"]),
      ),
    )
    .for("update", { of: savedPaymentMethod, skipLocked: true });
  const balances = await teamBalances(
    db,
    rows.map((r) => r.teamSeasonId),
  );
  const plan: GuaranteePlan = { warned: 0, charges: 0 };
  for (const r of rows) {
    const balanceCents = balances.get(r.teamSeasonId)?.balanceCents ?? 0;
    const step = guaranteeStep(
      {
        deadline: r.deadline,
        balanceCents,
        warnedForDeadline: r.warnedForDeadline,
        warnedAt: r.warnedAt,
        charged: r.chargePurchaseId !== null,
      },
      now,
    );
    if (step === "warn" && r.deadline) {
      await db
        .update(savedPaymentMethod)
        .set({ warnedAt: now, warnedForDeadline: r.deadline })
        .where(eq(savedPaymentMethod.id, r.id));
      const payload: GuaranteeWarningPayload = {
        teamName: r.teamName,
        seasonName: r.seasonName,
        seasonSlug: r.seasonSlug,
        balance: formatCents(balanceCents),
        chargeOn: formatMoment(chargeTime(r.deadline, now), r.timeZone),
        card: describeCard(r.brand, r.last4),
      };
      await enqueueMessages(db, [
        {
          userId: r.userId,
          topic: "payment",
          template: "guarantee_warning",
          payload,
          dedupeKey: `guarantee-warning/${r.id}/${r.deadline.toISOString()}`,
          sendAfter: now,
        },
      ]);
      plan.warned += 1;
    } else if (step === "charge") {
      const [created] = await db
        .insert(purchase)
        .values({
          userId: r.userId,
          seasonId: r.seasonId,
          subtotalCents: balanceCents,
          totalCents: balanceCents,
        })
        .returning({ id: purchase.id });
      if (!created) continue;
      await db.insert(purchaseItem).values({
        purchaseId: created.id,
        kind: "balance",
        teamSeasonId: r.teamSeasonId,
        amountCents: balanceCents,
        description: `${r.seasonName}: ${r.teamName} balance`,
      });
      await db
        .update(savedPaymentMethod)
        .set({ chargePurchaseId: created.id })
        .where(eq(savedPaymentMethod.id, r.id));
      await recordAudit(db, {
        actorId: null,
        action: "guarantee.charge",
        entityType: "team_season",
        entityId: r.teamSeasonId,
        after: { purchaseId: created.id, cents: balanceCents },
      });
      plan.charges += 1;
    }
  }
  return plan;
}

export type ChargeToSend = {
  purchaseId: PurchaseId;
  cents: number;
  customerId: string;
  paymentMethodId: string;
};

/**
 * Deadline charges created but not yet accepted by Stripe: new ones, and any
 * a stopped run left behind. Sending one again uses the same idempotency
 * key, so Stripe charges it once.
 */
export async function chargesToSend(db: Db): Promise<ChargeToSend[]> {
  return db
    .select({
      purchaseId: purchase.id,
      cents: purchase.totalCents,
      customerId: savedPaymentMethod.stripeCustomerId,
      paymentMethodId: savedPaymentMethod.stripePaymentMethodId,
    })
    .from(savedPaymentMethod)
    .innerJoin(purchase, eq(savedPaymentMethod.chargePurchaseId, purchase.id))
    .where(
      and(eq(purchase.status, "open"), isNull(purchase.stripePaymentIntentId)),
    );
}

/** Stores the PaymentIntent Stripe made for a deadline charge. */
export async function recordChargeIntent(
  db: Db,
  purchaseId: PurchaseId,
  intentId: string,
): Promise<void> {
  await db
    .update(purchase)
    .set({ stripePaymentIntentId: intentId })
    .where(
      and(eq(purchase.id, purchaseId), isNull(purchase.stripePaymentIntentId)),
    );
}

/**
 * A deadline charge was declined: the purchase fails and the captain is
 * told, once. The team stays unconfirmed until the balance is paid; the
 * card is not tried again on its own.
 */
export async function failCharge(
  db: Db,
  purchaseId: PurchaseId,
  now: Date,
): Promise<boolean> {
  const failed = await db
    .update(purchase)
    .set({ status: "failed" })
    .where(and(eq(purchase.id, purchaseId), eq(purchase.status, "open")))
    .returning({ id: purchase.id });
  if (failed.length === 0) return false;
  const [about] = await db
    .select({
      userId: savedPaymentMethod.userId,
      cents: purchase.totalCents,
      teamName: team.name,
      seasonName: season.name,
      seasonSlug: season.slug,
    })
    .from(savedPaymentMethod)
    .innerJoin(purchase, eq(savedPaymentMethod.chargePurchaseId, purchase.id))
    .innerJoin(teamSeason, eq(savedPaymentMethod.teamSeasonId, teamSeason.id))
    .innerJoin(team, eq(teamSeason.teamId, team.id))
    .innerJoin(season, eq(teamSeason.seasonId, season.id))
    .where(eq(savedPaymentMethod.chargePurchaseId, purchaseId));
  if (!about) return true;
  const payload: GuaranteeFailedPayload = {
    teamName: about.teamName,
    seasonName: about.seasonName,
    seasonSlug: about.seasonSlug,
    balance: formatCents(about.cents),
  };
  await enqueueMessages(db, [
    {
      userId: about.userId,
      topic: "payment",
      template: "guarantee_failed",
      payload,
      dedupeKey: `guarantee-failed/${purchaseId}`,
      sendAfter: now,
    },
  ]);
  return true;
}
