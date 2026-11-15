import { db } from "@/db/client";
import { isSetupLead } from "@/db/queries/game-day-checklist";
import type { Subject } from "@/domain/authz/permissions";
import type { SeasonId, UserId } from "@/domain/ids";
import { localDay } from "@/domain/schedule/public-game";

/**
 * Whether the signed-in person leads set-up on a game's day (issue #409):
 * they claimed the season's "Set-up lead" shift that day. The answer goes
 * into the permission context as `setupLead`.
 */
export async function leadsSetupOn(
  subject: Subject,
  game: { seasonId: SeasonId; startsAt: Date; timeZone: string },
): Promise<boolean> {
  if (subject.userId === null) return false;
  return isSetupLead(db, {
    userId: subject.userId as UserId,
    seasonId: game.seasonId,
    date: localDay(game.startsAt, game.timeZone),
    timeZone: game.timeZone,
  });
}
