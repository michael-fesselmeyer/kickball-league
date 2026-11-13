import { and, eq, inArray, sum } from "drizzle-orm";
import type { TeamSeasonId } from "@/domain/ids";
import { teamBalanceCents, teamFeeCents } from "@/domain/money/team-balance";
import { purchase, purchaseItem } from "../schema/money";
import { season } from "../schema/season";
import { teamSeason } from "../schema/team";
import type { Db } from "./schedule";

/**
 * Split-pay team balances (docs/data-model.md, section 2.3): the fee minus
 * what has been paid toward the team, computed from purchases. A refund
 * does not reopen a balance; whether a refunded player still owes is the
 * admin's call.
 */

/** Purchases that took money count, even if some went back later. */
export const PAID_STATUSES = [
  "paid",
  "partially_refunded",
  "refunded",
] as const;

/** Item kinds that pay toward a split team's fee. */
const TOWARD_FEE = ["team_fee", "player_share", "balance"] as const;

export type TeamBalance = {
  teamSeasonId: TeamSeasonId;
  feeCents: number;
  paidCents: number;
  balanceCents: number;
};

/**
 * Balances for split-pay teams in per-team seasons. Teams paid in full, or in
 * per-player seasons, have no team balance and are left out.
 */
export async function teamBalances(
  db: Db,
  ids: readonly TeamSeasonId[],
): Promise<Map<TeamSeasonId, TeamBalance>> {
  const result = new Map<TeamSeasonId, TeamBalance>();
  if (ids.length === 0) return result;
  const [teams, paid] = await Promise.all([
    db
      .select({
        id: teamSeason.id,
        createdAt: teamSeason.createdAt,
        paymentMode: teamSeason.paymentMode,
        status: season.status,
        feeModel: season.feeModel,
        teamFeeCents: season.teamFeeCents,
        playerFeeCents: season.playerFeeCents,
        freeAgentFeeCents: season.freeAgentFeeCents,
        earlyBirdEndsAt: season.earlyBirdEndsAt,
        earlyBirdDiscountCents: season.earlyBirdDiscountCents,
        registrationOpensAt: season.registrationOpensAt,
        registrationClosesAt: season.registrationClosesAt,
      })
      .from(teamSeason)
      .innerJoin(season, eq(teamSeason.seasonId, season.id))
      .where(inArray(teamSeason.id, [...ids])),
    db
      .select({
        id: purchaseItem.teamSeasonId,
        cents: sum(purchaseItem.amountCents).mapWith(Number),
      })
      .from(purchaseItem)
      .innerJoin(purchase, eq(purchaseItem.purchaseId, purchase.id))
      .where(
        and(
          inArray(purchaseItem.teamSeasonId, [...ids]),
          inArray(purchaseItem.kind, [...TOWARD_FEE]),
          inArray(purchase.status, [...PAID_STATUSES]),
        ),
      )
      .groupBy(purchaseItem.teamSeasonId),
  ]);
  const paidBy = new Map(paid.map((p) => [p.id, p.cents]));
  for (const t of teams) {
    if (t.feeModel !== "per_team" || t.paymentMode !== "split") continue;
    const fee = teamFeeCents(t, t.createdAt);
    if (fee === null) continue;
    const paidCents = paidBy.get(t.id) ?? 0;
    result.set(t.id, {
      teamSeasonId: t.id,
      feeCents: fee,
      paidCents,
      balanceCents: teamBalanceCents(fee, paidCents),
    });
  }
  return result;
}

/** Confirms split-pay teams whose shares and balance now cover the fee. */
export async function confirmCoveredTeams(
  db: Db,
  ids: readonly TeamSeasonId[],
): Promise<void> {
  const balances = await teamBalances(db, ids);
  const covered = [...balances.values()]
    .filter((b) => b.balanceCents === 0)
    .map((b) => b.teamSeasonId);
  if (covered.length === 0) return;
  await db
    .update(teamSeason)
    .set({ status: "confirmed" })
    .where(
      and(
        inArray(teamSeason.id, covered),
        inArray(teamSeason.status, ["forming", "pending_payment"]),
      ),
    );
}
