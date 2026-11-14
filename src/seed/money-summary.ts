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
import type { LeagueId } from "@/domain/ids";
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

/**
 * The fall players' fees, recorded as paid outside the app (cash or Venmo,
 * entered by the admin) a few days before registration closed, so the
 * books, the dashboard and the summary have money in. Seed players only:
 * the demo personas keep the payments their own flows make. Cleared with
 * the season's other purchases (removeMoneyRecords).
 */
export async function addSeedFeePayments(tx: Db, data: SeedData) {
  const fee = data.season.playerFeeCents;
  const admin = data.profiles.find((p) => p.globalRole === "admin");
  if (!admin) return;
  const teamOf = new Map(
    data.rosterMemberships.map((m) => [m.registrationId, m.teamSeasonId]),
  );
  const closes = data.season.registrationClosesAt.getTime();
  for (const [i, r] of data.registrations.entries()) {
    const paidAt = new Date(closes - (i % 9) * 86_400_000);
    const [bought] = await tx
      .insert(purchase)
      .values({
        userId: r.userId,
        seasonId: r.seasonId,
        status: "paid",
        subtotalCents: fee,
        totalCents: fee,
        createdAt: paidAt,
      })
      .returning({ id: purchase.id });
    if (!bought) continue;
    await tx.insert(purchaseItem).values({
      purchaseId: bought.id,
      kind: "player_fee",
      teamSeasonId: teamOf.get(r.id) ?? null,
      registrationId: r.id,
      amountCents: fee,
      description: `${data.season.name} player fee`,
    });
    await tx.insert(payment).values({
      purchaseId: bought.id,
      method: i % 3 === 0 ? "venmo" : "cash",
      note: "Paid at sign-up night",
      recordedBy: admin.userId,
      amountCents: fee,
      status: "succeeded",
      paidAt,
      createdAt: paidAt,
    });
  }
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
