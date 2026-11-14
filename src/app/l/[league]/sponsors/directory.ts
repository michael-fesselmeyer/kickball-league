import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/db/client";
import { leagueById } from "@/db/queries/leagues";
import { sponsorDirectory } from "@/db/queries/sponsors";
import type { LeagueId } from "@/domain/ids";
import { readUnlessBuildHasNoDatabase } from "@/lib/build-phase";
import { PUBLIC_PAGE_LIFE, SPONSORS_TAG } from "@/lib/public-cache";

/**
 * The sponsors list and every sponsor page read this one cached directory:
 * a league has a handful of sponsors, so one read serves them all, and one
 * tag expires them all when a sponsor, deal or team of the week changes.
 */
export async function cachedSponsorDirectory(leagueId: LeagueId) {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  cacheTag(SPONSORS_TAG);
  const found = await readUnlessBuildHasNoDatabase(async () => {
    const league = await leagueById(db, leagueId);
    if (!league) return null;
    return sponsorDirectory(db, league.id, league.timeZone);
  });
  return found ?? { sponsors: [], teamOfWeek: null };
}
