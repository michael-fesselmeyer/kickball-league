import { eq } from "drizzle-orm";
import type { LeagueId, UserId } from "@/domain/ids";
import {
  type FeeSettings,
  readFeeSettings,
} from "@/domain/money/processing-fee";
import { league } from "../schema/league";
import { recordAudit } from "./audit";
import type { Db } from "./schedule";

/**
 * The league's processing-fee setting (ADR 0082). Off unless the owners
 * turned it on; anything missing reads as the defaults.
 */
export async function feeSettingsOf(
  db: Db,
  leagueId: LeagueId,
): Promise<FeeSettings> {
  const [row] = await db
    .select({ fees: league.processingFees })
    .from(league)
    .where(eq(league.id, leagueId));
  return readFeeSettings(row?.fees);
}

/** Saves the setting under a lock on the league, with an audit row. */
export async function saveFeeSettings(
  db: Db,
  input: { leagueId: LeagueId; actorId: UserId; settings: FeeSettings },
): Promise<boolean> {
  const [before] = await db
    .select({ fees: league.processingFees })
    .from(league)
    .where(eq(league.id, input.leagueId))
    .for("update");
  if (!before) return false;
  await db
    .update(league)
    .set({ processingFees: input.settings })
    .where(eq(league.id, input.leagueId));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "processing_fees.update",
    entityType: "league",
    entityId: input.leagueId,
    before: { settings: readFeeSettings(before.fees) },
    after: { settings: input.settings },
  });
  return true;
}
