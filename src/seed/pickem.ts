import type { Db } from "@/db/queries/schedule";
import { pickemPick } from "@/db/schema";
import { seededRandom } from "@/domain/random";
import type { SeedData } from "./generate";

/**
 * Pick'em for the demo's fall season: about half the league picked each
 * played game, the night before, leaning toward the team that went on to
 * win, so the leaderboards have a spread of scores and some shared places.
 * The games still to come have no picks. Bragging rights only (ADR 0044).
 */
export function seedPickRows(data: SeedData) {
  const random = seededRandom(288);
  const players = [...new Set(data.registrations.map((r) => r.userId))];
  const slots = new Map(data.slots.map((s) => [s.id as string, s]));
  return data.games
    .filter((g) => g.status === "final" && g.slotId)
    .flatMap((g) => {
      const slot = slots.get(g.slotId);
      if (!slot) return [];
      const winner = (g.scoreA ?? 0) >= (g.scoreB ?? 0) ? g.teamAId : g.teamBId;
      const loser = winner === g.teamAId ? g.teamBId : g.teamAId;
      const madeAt = new Date(slot.startsAt.getTime() - 20 * 3_600_000);
      return players.flatMap((userId) =>
        random.next() < 0.5
          ? [
              {
                gameId: g.id,
                userId,
                teamSeasonId: random.next() < 0.6 ? winner : loser,
                slotId: slot.id,
                createdAt: madeAt,
                updatedAt: madeAt,
              },
            ]
          : [],
      );
    });
}

export async function addSeedPicks(db: Db, data: SeedData): Promise<void> {
  const rows = seedPickRows(data);
  // In chunks: a few thousand rows is more parameters than one insert takes.
  for (let i = 0; i < rows.length; i += 1000)
    await db.insert(pickemPick).values(rows.slice(i, i + 1000));
}
