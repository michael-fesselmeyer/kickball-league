import { eq, max } from "drizzle-orm";
import type { Db } from "@/db/queries/schedule";
import { loadSchedulerInput } from "@/db/queries/schedule";
import { game } from "@/db/schema/game";
import { gamePlacement, scheduleVersion } from "@/db/schema/schedule";
import type { SeasonId } from "@/domain/ids";

/**
 * Publishes the seeded season's games as its first schedule version, placed
 * where the seed put them, so the public schedule, team and game pages and
 * the calendar feeds have something to show. Inserts directly: the seeded
 * round robin is fixed, not the scheduler's output.
 */
export async function seedPublishedSchedule(
  db: Db,
  seasonId: SeasonId,
): Promise<void> {
  const games = await db
    .select({ id: game.id, slotId: game.slotId })
    .from(game)
    .where(eq(game.seasonId, seasonId));
  const [rounds] = await db
    .select({ last: max(game.roundNo) })
    .from(game)
    .where(eq(game.seasonId, seasonId));
  const input = await loadSchedulerInput(db, seasonId, {
    rounds: rounds?.last ?? 0,
    reservePerDay: 0,
    seed: 1,
  });
  if (!input.ok) throw new Error(`Cannot seed a schedule: ${input.error}`);
  const [version] = await db
    .insert(scheduleVersion)
    .values({
      seasonId,
      versionNo: 1,
      origin: "generated",
      status: "published",
      seed: 1,
      inputSnapshot: input.value,
      publishedAt: new Date(),
      note: "Seeded round robin",
    })
    .returning({ id: scheduleVersion.id });
  if (!version) throw new Error("Cannot seed a schedule version");
  await db.insert(gamePlacement).values(
    games.map((g) => ({
      scheduleVersionId: version.id,
      gameId: g.id,
      slotId: g.slotId,
    })),
  );
}
