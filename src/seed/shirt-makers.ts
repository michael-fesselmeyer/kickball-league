import type { Db } from "@/db/queries/schedule";
import { shirtMaker, teamSeason } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { MakerFields } from "@/domain/shirts/makers";
import type { SeedData } from "./generate";

/**
 * The demo league's shirt makers: invented businesses on example.test
 * sites. They go with the league when it is deleted.
 */
export const SEED_SHIRT_MAKERS: readonly MakerFields[] = [
  {
    name: "Corner Print Shop",
    url: "https://corner-print-shop.example.test/",
    makes: "Custom jerseys and team t-shirts, screen printed.",
    minimumOrder: 12,
  },
  {
    name: "Brooklyn Stitch & Press",
    url: "https://stitch-and-press.example.test/",
    makes: "Embroidered and pressed team jerseys, rush orders on request.",
    minimumOrder: 6,
  },
  {
    name: "Two Blocks Tees",
    url: "https://two-blocks-tees.example.test/",
    makes: "Small runs of printed t-shirts for clubs and leagues.",
    minimumOrder: null,
  },
];

const DESIGNS = [
  "Bright color jersey with a white collar and the number on the back",
  "Black tee, team name across the chest in white",
  "Retro striped jersey with sleeve piping",
] as const;

export async function addSeedShirtMakers(
  db: Db,
  data: SeedData,
): Promise<void> {
  await db
    .insert(shirtMaker)
    .values(SEED_SHIRT_MAKERS.map((m) => ({ leagueId: data.league.id, ...m })));
  // A few teams describe their shirt, so the history page's archive has
  // something to show.
  for (const [i, entry] of data.teamSeasons.slice(0, DESIGNS.length).entries())
    await db
      .update(teamSeason)
      .set({ shirtDesign: DESIGNS[i] })
      .where(eq(teamSeason.id, entry.id));
}
