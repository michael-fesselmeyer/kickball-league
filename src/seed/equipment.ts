import type { Db } from "@/db/queries/schedule";
import { equipmentKit } from "@/db/schema";
import type { SeedData } from "./generate";

/**
 * Two kits of league gear for the demo league (issue #286), both at home
 * and assigned to no game, so the admin's League gear screen has something
 * to show and nobody's home screen changes. Deleting the league removes
 * them, with any handoffs and reports a demo visitor made.
 */
export const SEED_KITS = [
  {
    name: "Kit A",
    contents: [
      "Ball bag (4 balls)",
      "Bases (4) and home plate",
      "Pump with needle",
      "Cones (8)",
      "First-aid kit",
    ],
    homeLocation: "Storage locker by the park house",
  },
  {
    name: "Kit B",
    contents: [
      "Ball bag (3 balls)",
      "Bases (4)",
      "Pump with needle",
      "Cones (6)",
    ],
    homeLocation: "Behind the bar at the sponsor's",
  },
] as const;

export async function addSeedKits(db: Db, data: SeedData): Promise<void> {
  await db.insert(equipmentKit).values(
    SEED_KITS.map((kit) => ({
      ...kit,
      contents: [...kit.contents],
      leagueId: data.league.id,
    })),
  );
}
