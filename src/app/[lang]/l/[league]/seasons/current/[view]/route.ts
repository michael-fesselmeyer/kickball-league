import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/db/client";
import type { LeagueId } from "@/domain/ids";
import { seasonList } from "@/db/queries/sitemap";
import { leagueHref } from "@/domain/league/paths";
import { currentSeason, isCurrentSeasonView } from "@/domain/season/current";
import { localeOf } from "@/i18n/messages";
import { linkIn } from "@/i18n/routing";
import { cachedLeague } from "@/lib/league/public";
import { PUBLIC_PAGE_LIFE, SEASONS_TAG } from "@/lib/public-cache";

/**
 * The header's "Schedule" and "Standings" (docs/information-architecture.md,
 * Navigation): a short hop to the season being played. The header itself
 * is part of every static page, so it can't name the season without every
 * page expiring each time a score changes the season list; this address
 * asks instead, from the same cached list as the /seasons page.
 */
async function currentSlug(leagueId: LeagueId): Promise<string | null> {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  cacheTag(SEASONS_TAG);
  return currentSeason(await seasonList(db, leagueId))?.slug ?? null;
}

export async function GET(
  _request: Request,
  ctx: RouteContext<"/[lang]/l/[league]/seasons/current/[view]">,
) {
  const { lang, league: segment, view } = await ctx.params;
  const league = await cachedLeague(segment);
  if (!league || !isCurrentSeasonView(view))
    return new Response("Not found", { status: 404 });
  const slug = await currentSlug(league.id);
  const path = slug ? `/seasons/${slug}/${view}` : "/seasons";
  const to = linkIn(localeOf(lang), leagueHref(league, path));
  return new Response(null, {
    status: 307,
    headers: {
      Location: to,
      "Cache-Control": "public, max-age=0, s-maxage=60",
    },
  });
}
