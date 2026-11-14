import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import { notFound, permanentRedirect } from "next/navigation";
import { db } from "@/db/client";
import {
  allLeagues,
  type LeagueInfo,
  leagueBySegment,
} from "@/db/queries/leagues";
import { DEFAULT_LEAGUE_SEGMENT, leagueHref } from "@/domain/league/paths";
import { PUBLIC_PAGE_LIFE } from "@/lib/public-cache";

/** Every league's public pages; expired when the operator adds or changes a league. */
export const LEAGUES_TAG = "leagues";

/**
 * The league of a public page's `[league]` segment, cached like the page's
 * own data (ADR 0048). Null when there is no such league.
 */
export async function cachedLeague(
  segment: string,
): Promise<LeagueInfo | null> {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  cacheTag(LEAGUES_TAG);
  return leagueBySegment(db, segment);
}

/**
 * For a public page: its league, or not found. The default league's pages
 * have one address only, so `/l/<default slug>/...` redirects to the site's
 * own URL for the same page.
 */
export async function publicLeague(
  segment: string,
  path: string,
): Promise<LeagueInfo> {
  const league = await cachedLeague(segment);
  if (!league) notFound();
  if (segment !== DEFAULT_LEAGUE_SEGMENT && league.isDefault)
    permanentRedirect(leagueHref(league, path));
  return league;
}

/**
 * The `[league]` segments to prerender: the default league's, and every
 * other league's slug. A build with no database lists only the default.
 */
export async function leagueSegments(): Promise<{ league: string }[]> {
  try {
    const leagues = await allLeagues(db);
    return [
      { league: DEFAULT_LEAGUE_SEGMENT },
      ...leagues.filter((l) => !l.isDefault).map((l) => ({ league: l.slug })),
    ];
  } catch (error) {
    console.warn(
      `[build] Only the default league prerendered: the database could not be read (${
        error instanceof Error ? error.message : String(error)
      }).`,
    );
    return [{ league: DEFAULT_LEAGUE_SEGMENT }];
  }
}

/**
 * A league page's metadata with its canonical address, which for a league
 * other than the default carries its /l/<slug> prefix.
 */
export async function withCanonical(
  params: Promise<{ league: string }>,
  metadata: Metadata,
  path: string,
): Promise<Metadata> {
  const league = await cachedLeague((await params).league);
  return {
    ...metadata,
    alternates: {
      ...metadata.alternates,
      canonical: league ? leagueHref(league, path) : path,
    },
  };
}
