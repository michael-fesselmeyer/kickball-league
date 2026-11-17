import { eq, inArray } from "drizzle-orm";
import { publishSummary, summaryInputs } from "@/db/queries/owner-dashboard";
import type { Db } from "@/db/queries/schedule";
import {
  moneySummary,
  payment,
  purchase,
  purchaseItem,
  season,
} from "@/db/schema";
import {
  buildMoneySummary,
  seasonFees,
  seasonMoney,
} from "@/domain/dashboard/money";
import type {
  LeagueId,
  RegistrationId,
  SeasonId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import type { SeedData } from "./generate";

/**
 * A published money summary for the demo league's current season (ADR
 * 0038), built from its seeded payments and books exactly as an owner's
 * publish would, so the public page has something to show.
 */

/** Clears published summaries before the league's seasons are removed. */
export async function removeSeedMoneySummaries(tx: Db, leagueId: LeagueId) {
  const seasonIds = tx
    .select({ id: season.id })
    .from(season)
    .where(eq(season.leagueId, leagueId));
  await tx
    .delete(moneySummary)
    .where(inArray(moneySummary.seasonId, seasonIds));
}

/** Stripe's card fee on a payment: 2.9% plus 30 cents, rounded. */
export const seedCardFeeCents = (amountCents: number) =>
  Math.round(amountCents * 0.029) + 30;

/** How a seeded fee was paid: most in the app, every fifth outside it. */
export function seedPaymentMethod(i: number): "stripe" | "venmo" | "cash" {
  if (i % 5 !== 4) return "stripe";
  return i % 2 === 0 ? "venmo" : "cash";
}

export type SeedFee = {
  userId: UserId;
  seasonId: SeasonId;
  registrationId: RegistrationId;
  teamSeasonId: TeamSeasonId | null;
  amountCents: number;
  description: string;
  paidAt: Date;
  /** Unique among the seed's payments, for the made-up Stripe ids. */
  key: string;
};

/**
 * Records seeded player fees as paid: most through the app's checkout
 * (made-up Stripe ids on the seed's own `seed_` prefix, with the card fee
 * Stripe would keep), and every fifth outside it, in cash or Venmo,
 * entered by the admin. Cleared with the season's other purchases.
 */
export async function insertSeedFees(
  tx: Db,
  leagueId: LeagueId,
  adminId: UserId,
  fees: readonly SeedFee[],
): Promise<void> {
  for (const [i, f] of fees.entries()) {
    const method = seedPaymentMethod(i);
    const inApp = method === "stripe";
    const [bought] = await tx
      .insert(purchase)
      .values({
        userId: f.userId,
        leagueId,
        seasonId: f.seasonId,
        status: "paid",
        subtotalCents: f.amountCents,
        totalCents: f.amountCents,
        stripeCheckoutSessionId: inApp ? `cs_seed_${f.key}` : null,
        createdAt: f.paidAt,
      })
      .returning({ id: purchase.id });
    if (!bought) continue;
    await tx.insert(purchaseItem).values({
      purchaseId: bought.id,
      kind: "player_fee",
      teamSeasonId: f.teamSeasonId,
      registrationId: f.registrationId,
      amountCents: f.amountCents,
      description: f.description,
    });
    await tx.insert(payment).values({
      purchaseId: bought.id,
      method,
      ...(inApp
        ? {
            stripePaymentIntentId: `pi_seed_${f.key}`,
            stripeChargeId: `ch_seed_${f.key}`,
            stripeFeeCents: seedCardFeeCents(f.amountCents),
          }
        : { note: "Paid at sign-up night", recordedBy: adminId }),
      amountCents: f.amountCents,
      status: "succeeded",
      paidAt: f.paidAt,
      createdAt: f.paidAt,
    });
  }
}

/**
 * The fall players' fees, paid in the days before registration closed, so
 * the books, the dashboard and the summary have money in, most of it
 * through the app. Seed players only: the demo personas keep the payments
 * their own flows make.
 */
export async function addSeedFeePayments(tx: Db, data: SeedData) {
  const admin = data.profiles.find((p) => p.globalRole === "admin");
  if (!admin) return;
  const teamOf = new Map(
    data.rosterMemberships.map((m) => [m.registrationId, m.teamSeasonId]),
  );
  const closes = data.season.registrationClosesAt.getTime();
  await insertSeedFees(
    tx,
    data.league.id,
    admin.userId,
    data.registrations.map((r, i) => ({
      userId: r.userId,
      seasonId: r.seasonId,
      registrationId: r.id,
      teamSeasonId: teamOf.get(r.id) ?? null,
      amountCents: data.season.playerFeeCents,
      description: `${data.season.name} player fee`,
      paidAt: new Date(closes - (i % 9) * 86_400_000),
      key: `${data.season.slug}_${i + 1}`,
    })),
  );
}

/** Runs after the books are seeded, so the summary includes their expenses. */
export async function addSeedMoneySummary(tx: Db, data: SeedData) {
  // The demo league has no owner account; its admin stands in.
  const publisher = data.profiles.find((p) => p.globalRole === "admin");
  if (!publisher) return;
  const [current] = await tx
    .select()
    .from(season)
    .where(eq(season.id, data.season.id));
  if (!current) return;
  const inputs = await summaryInputs(tx, data.league.id, current.id);
  const money = seasonMoney({ seasonId: current.id, ...inputs });
  await publishSummary(
    tx,
    {
      seasonId: current.id,
      folded: [],
      summary: buildMoneySummary(money, seasonFees(current), []),
    },
    publisher.userId,
  );
}
