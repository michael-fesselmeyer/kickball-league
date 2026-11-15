import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/queries/schedule";
import {
  refereeAssignment,
  refereePayout,
  refereePayRate,
  refereeProfile,
} from "@/db/schema";
import type { SeasonId } from "@/domain/ids";
import { PERSONAS } from "@/lib/demo/personas";
import { demoPersonaRows } from "./demo-personas";
import { PLAYED_ROUNDS, type SeedData } from "./generate";

/** The fall season's per-game ref fee, in cents. */
export const SEED_REF_FEE_CENTS = 2500;

/**
 * The ref pool and pay sheet for the demo (ADR 0053): Reese Ref is the
 * league's one pooled ref, the fall season pays $25 a game, and Reese
 * checked in for the first two games of the last played round, so the pay
 * sheet has something owed. Reese says nothing about times yet; the
 * "assign then pay" flow ticks them on the ref's own page.
 */
export function seedRefereePoolRows(data: SeedData) {
  const rows = demoPersonaRows(data);
  const ref = rows.users.find((u) => u.email === PERSONAS.ref.email);
  if (!ref) throw new Error("The seed has no demo ref");
  const played = new Set(
    data.games.filter((g) => g.roundNo === PLAYED_ROUNDS).map((g) => g.id),
  );
  const checkedIn = rows.refereeAssignments
    .filter((a) => played.has(a.gameId))
    .slice(0, 2)
    .map((a) => a.id);
  return {
    profile: { leagueId: data.league.id, userId: ref.id },
    rate: { seasonId: data.season.id, feeCents: SEED_REF_FEE_CENTS },
    checkedIn,
    checkedInAt: new Date("2026-10-06T23:40:00Z"),
  };
}

export async function addSeedRefereePool(
  db: Db,
  data: SeedData,
): Promise<void> {
  const rows = seedRefereePoolRows(data);
  await db.insert(refereeProfile).values(rows.profile);
  await db.insert(refereePayRate).values(rows.rate);
  if (rows.checkedIn.length > 0)
    await db
      .update(refereeAssignment)
      .set({ checkedInAt: rows.checkedInAt })
      .where(
        and(
          inArray(refereeAssignment.id, rows.checkedIn),
          eq(refereeAssignment.status, "accepted"),
        ),
      );
}

/**
 * Payouts recorded in an earlier run hold on to their season and ref, so
 * they go before the seed replaces the league. Their books expenses go
 * with the books.
 */
export async function removeSeedRefereePayouts(
  db: Db,
  seasonIds: readonly SeasonId[],
): Promise<void> {
  if (seasonIds.length > 0)
    await db
      .delete(refereePayout)
      .where(inArray(refereePayout.seasonId, [...seasonIds]));
}
