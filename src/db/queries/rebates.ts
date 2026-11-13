import { and, eq, inArray, notInArray, or, sum } from "drizzle-orm";
import type {
  SeasonId,
  SeasonRebateId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import {
  DEFAULT_REBATE_THRESHOLD_PCT,
  isGameLost,
  quoteRebate,
  type RebateQuote,
  splitRebate,
} from "@/domain/money/rebate";
import { formatCents } from "@/domain/registration/pricing";
import { err, ok, type Result } from "@/domain/result";
import type { RebateCreditPayload } from "@/emails/money";
import { creditEntry, seasonRebate } from "../schema/credit";
import { game, slot } from "../schema/game";
import { payment, purchase, purchaseItem } from "../schema/money";
import { gamePlacement, scheduleVersion } from "../schema/schedule";
import { season } from "../schema/season";
import { rosterMembership, team, teamSeason } from "../schema/team";
import { recordAudit } from "./audit";
import { enqueueMessages } from "./outbox";
import type { Db } from "./schedule";
import { PAID_STATUSES } from "./team-balance";

/**
 * The season rebate tool (product-spec.md, "Season rebate tool"). For each
 * team: its regular games in the published schedule, how many were lost,
 * what was paid for it and by whom, and the rebate the season's policy
 * suggests. Issuing it turns each payer's share into league credit.
 */

export type RebateRow = RebateQuote & {
  teamSeasonId: TeamSeasonId;
  teamName: string;
  gamesCount: number;
  gamesLost: number;
  paidCents: number;
  payers: { userId: UserId; paidCents: number }[];
  issued: { id: SeasonRebateId; rebateCents: number; createdAt: Date } | null;
};

/** Games per team in the published schedule, and how many were lost. */
async function gameCounts(db: Db, seasonId: SeasonId) {
  const [published] = await db
    .select({ id: scheduleVersion.id })
    .from(scheduleVersion)
    .where(
      and(
        eq(scheduleVersion.seasonId, seasonId),
        eq(scheduleVersion.status, "published"),
      ),
    );
  const counts = new Map<string, { count: number; lost: number }>();
  if (!published) return counts;
  const rows = await db
    .select({
      teamA: game.teamAId,
      teamB: game.teamBId,
      status: game.status,
      slotId: gamePlacement.slotId,
      slotStatus: slot.status,
    })
    .from(gamePlacement)
    .innerJoin(game, eq(gamePlacement.gameId, game.id))
    .leftJoin(slot, eq(gamePlacement.slotId, slot.id))
    .where(
      and(
        eq(gamePlacement.scheduleVersionId, published.id),
        eq(game.kind, "regular"),
      ),
    );
  for (const r of rows) {
    const lost = isGameLost({
      status: r.status,
      placed: r.slotId !== null,
      slotCancelled: r.slotStatus === "cancelled",
    });
    for (const t of [r.teamA, r.teamB]) {
      const c = counts.get(t) ?? { count: 0, lost: 0 };
      c.count += 1;
      if (lost) c.lost += 1;
      counts.set(t, c);
    }
  }
  return counts;
}

/**
 * Who paid toward each team, and how much: the team's own fee and balance
 * items, plus every active member's own fee. Promo discounts and refunds
 * are taken off, so the amount is what really reached the league (credit
 * spent counts, since it was the player's).
 */
async function paidByTeam(db: Db, teamIds: readonly TeamSeasonId[]) {
  const result = new Map<TeamSeasonId, Map<UserId, number>>();
  if (teamIds.length === 0) return result;
  const members = await db
    .select({
      teamSeasonId: rosterMembership.teamSeasonId,
      registrationId: rosterMembership.registrationId,
    })
    .from(rosterMembership)
    .where(
      and(
        inArray(rosterMembership.teamSeasonId, [...teamIds]),
        eq(rosterMembership.status, "active"),
      ),
    );
  const teamOfRegistration = new Map(
    members.map((m) => [m.registrationId as string, m.teamSeasonId]),
  );
  const registrations = members.map((m) => m.registrationId);
  const items = await db
    .select({
      id: purchaseItem.id,
      purchaseId: purchase.id,
      userId: purchase.userId,
      teamSeasonId: purchaseItem.teamSeasonId,
      registrationId: purchaseItem.registrationId,
      amountCents: purchaseItem.amountCents,
      subtotalCents: purchase.subtotalCents,
      discountCents: purchase.discountCents,
    })
    .from(purchaseItem)
    .innerJoin(purchase, eq(purchaseItem.purchaseId, purchase.id))
    .where(
      and(
        inArray(purchase.status, [...PAID_STATUSES]),
        registrations.length > 0
          ? or(
              inArray(purchaseItem.teamSeasonId, [...teamIds]),
              inArray(purchaseItem.registrationId, registrations),
            )
          : inArray(purchaseItem.teamSeasonId, [...teamIds]),
      ),
    );
  const purchaseIds = [...new Set(items.map((i) => i.purchaseId))];
  const refunds =
    purchaseIds.length > 0
      ? await db
          .select({
            purchaseId: payment.purchaseId,
            refunded: sum(payment.refundedCents).mapWith(Number),
          })
          .from(payment)
          .where(inArray(payment.purchaseId, purchaseIds))
          .groupBy(payment.purchaseId)
      : [];
  const refundedOf = new Map(refunds.map((r) => [r.purchaseId, r.refunded]));
  for (const i of items) {
    const teamId =
      (i.teamSeasonId && teamIds.includes(i.teamSeasonId)
        ? i.teamSeasonId
        : null) ??
      (i.registrationId ? teamOfRegistration.get(i.registrationId) : null);
    if (!teamId || i.subtotalCents === 0) continue;
    const net = Math.max(
      0,
      i.subtotalCents - i.discountCents - (refundedOf.get(i.purchaseId) ?? 0),
    );
    const cents = Math.floor((i.amountCents * net) / i.subtotalCents);
    const byUser = result.get(teamId) ?? new Map<UserId, number>();
    byUser.set(i.userId, (byUser.get(i.userId) ?? 0) + cents);
    result.set(teamId, byUser);
  }
  return result;
}

export async function rebateBoard(
  db: Db,
  seasonId: SeasonId,
  teamSeasonId?: TeamSeasonId,
): Promise<{ thresholdPct: number; rows: RebateRow[] }> {
  const [s] = await db
    .select({ policy: season.rebatePolicy })
    .from(season)
    .where(eq(season.id, seasonId));
  const thresholdPct = s?.policy.thresholdPct ?? DEFAULT_REBATE_THRESHOLD_PCT;
  const teams = await db
    .select({ id: teamSeason.id, name: team.name })
    .from(teamSeason)
    .innerJoin(team, eq(teamSeason.teamId, team.id))
    .where(
      and(
        eq(teamSeason.seasonId, seasonId),
        notInArray(teamSeason.status, ["withdrawn", "waitlisted"]),
        ...(teamSeasonId ? [eq(teamSeason.id, teamSeasonId)] : []),
      ),
    )
    .orderBy(team.name);
  const ids = teams.map((t) => t.id);
  const [counts, paid, issued] = await Promise.all([
    gameCounts(db, seasonId),
    paidByTeam(db, ids),
    ids.length > 0
      ? db
          .select({
            id: seasonRebate.id,
            teamSeasonId: seasonRebate.teamSeasonId,
            rebateCents: seasonRebate.rebateCents,
            createdAt: seasonRebate.createdAt,
          })
          .from(seasonRebate)
          .where(inArray(seasonRebate.teamSeasonId, ids))
      : Promise.resolve([]),
  ]);
  const issuedOf = new Map(issued.map((r) => [r.teamSeasonId, r]));
  const rows = teams.map((t): RebateRow => {
    const c = counts.get(t.id) ?? { count: 0, lost: 0 };
    const payers = [...(paid.get(t.id) ?? new Map()).entries()]
      .map(([userId, cents]) => ({ userId, paidCents: cents }))
      .filter((p) => p.paidCents > 0);
    const paidCents = payers.reduce((total, p) => total + p.paidCents, 0);
    const done = issuedOf.get(t.id);
    return {
      teamSeasonId: t.id,
      teamName: t.name,
      gamesCount: c.count,
      gamesLost: c.lost,
      paidCents,
      payers,
      ...quoteRebate({
        gamesCount: c.count,
        gamesLost: c.lost,
        paidCents,
        thresholdPct,
      }),
      issued: done
        ? {
            id: done.id,
            rebateCents: done.rebateCents,
            createdAt: done.createdAt,
          }
        : null,
    };
  });
  return { thresholdPct, rows };
}

export type RebateError = "unknown_team" | "not_eligible" | "already_issued";

/**
 * Issues a team's rebate as league credit to each person who paid toward
 * it, in proportion to what they paid, and emails them. A team gets one
 * rebate per season; the unique key stops a second one even if two admins
 * press the button at once.
 */
export async function issueRebate(
  db: Db,
  input: {
    seasonId: SeasonId;
    teamSeasonId: TeamSeasonId;
    actorId: UserId;
    now: Date;
  },
): Promise<Result<{ rebateCents: number; payers: number }, RebateError>> {
  await db
    .select({ id: teamSeason.id })
    .from(teamSeason)
    .where(eq(teamSeason.id, input.teamSeasonId))
    .for("update");
  const board = await rebateBoard(db, input.seasonId, input.teamSeasonId);
  const row = board.rows[0];
  if (!row) return err("unknown_team");
  if (row.issued) return err("already_issued");
  if (!row.eligible || row.rebateCents <= 0) return err("not_eligible");
  const parts = splitRebate(row.rebateCents, row.payers);
  if (parts.length === 0) return err("not_eligible");
  const [created] = await db
    .insert(seasonRebate)
    .values({
      seasonId: input.seasonId,
      teamSeasonId: input.teamSeasonId,
      gamesCount: row.gamesCount,
      gamesLost: row.gamesLost,
      paidCents: row.paidCents,
      rebateCents: row.rebateCents,
      issuedBy: input.actorId,
      createdAt: input.now,
    })
    .onConflictDoNothing()
    .returning({ id: seasonRebate.id });
  if (!created) return err("already_issued");
  await db.insert(creditEntry).values(
    parts.map((p) => ({
      userId: p.userId as UserId,
      deltaCents: p.cents,
      reason: "rainout_rebate" as const,
      rebateId: created.id,
      issuedBy: input.actorId,
      note: `${row.gamesLost} of ${row.gamesCount} games lost`,
    })),
  );
  const [about] = await db
    .select({ seasonName: season.name })
    .from(season)
    .where(eq(season.id, input.seasonId));
  await enqueueMessages(
    db,
    parts.map((p) => {
      const payload: RebateCreditPayload = {
        amount: formatCents(p.cents),
        seasonName: about?.seasonName ?? "the season",
        teamName: row.teamName,
        gamesLost: row.gamesLost,
        gamesCount: row.gamesCount,
      };
      return {
        userId: p.userId as UserId,
        topic: "payment" as const,
        template: "rebate_credit",
        payload,
        dedupeKey: `rebate-credit/${created.id}/${p.userId}`,
        sendAfter: input.now,
      };
    }),
  );
  await recordAudit(db, {
    actorId: input.actorId,
    action: "credit.rebate",
    entityType: "team_season",
    entityId: input.teamSeasonId,
    after: {
      rebateId: created.id,
      rebateCents: row.rebateCents,
      gamesLost: row.gamesLost,
      gamesCount: row.gamesCount,
      payers: parts.length,
    },
  });
  return ok({ rebateCents: row.rebateCents, payers: parts.length });
}
