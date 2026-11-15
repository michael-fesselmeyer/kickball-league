import { inArray, or } from "drizzle-orm";
import type { Db } from "@/db/queries/schedule";
import { privateEvent } from "@/db/schema/private-event";
import type { LeagueId, UserId } from "@/domain/ids";

/**
 * Clears private events before a reset deletes what they point at: an event
 * restricts deleting its league, its season and its organizer, so a database
 * that holds one could not be reseeded.
 */
export async function removeSeedPrivateEvents(
  db: Db,
  ids: { leagueIds: LeagueId[]; userIds: UserId[] },
): Promise<void> {
  const { leagueIds, userIds } = ids;
  if (leagueIds.length === 0 && userIds.length === 0) return;
  await db
    .delete(privateEvent)
    .where(
      or(
        leagueIds.length ? inArray(privateEvent.leagueId, leagueIds) : undefined,
        userIds.length ? inArray(privateEvent.organizerId, userIds) : undefined,
      ),
    );
}
