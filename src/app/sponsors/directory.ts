import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/db/client";
import { currentLeague } from "@/db/queries/seasons";
import { sponsorDirectory } from "@/db/queries/sponsors";
import { readUnlessBuildHasNoDatabase } from "@/lib/build-phase";
import { PUBLIC_PAGE_LIFE, SPONSORS_TAG } from "@/lib/public-cache";

/**
 * The sponsors list and every sponsor page read this one cached directory:
 * a league has a handful of sponsors, so one read serves them all, and one
 * tag expires them all when a sponsor, deal or team of the week changes.
 */
export async function cachedSponsorDirectory() {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  cacheTag(SPONSORS_TAG);
  const found = await readUnlessBuildHasNoDatabase(async () => {
    const league = await currentLeague(db);
    if (!league) return null;
    return sponsorDirectory(db, league.id, league.timeZone);
  });
  return found ?? { sponsors: [], teamOfWeek: null };
}
