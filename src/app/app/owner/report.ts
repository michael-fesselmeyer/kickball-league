import { cacheLife, cacheTag } from "next/cache";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { type ReportExtras, reportExtras } from "@/db/queries/report-card";
import {
  factsFrom,
  REPORT_STATUSES,
  type SeasonFacts,
} from "@/domain/dashboard/report-card";
import type { SeasonId } from "@/domain/ids";
import {
  OWNER_DASHBOARD_LIFE,
  OWNER_DASHBOARD_TAG,
} from "@/lib/owner-dashboard-cache";
import { seasonTag } from "@/lib/public-cache";
import { cachedDashboard, ownerSeason } from "./load";

/**
 * The extra numbers for the report card, cached like the dashboard's
 * (OWNER_DASHBOARD_LIFE) and under the same tags. Ids only: callers check
 * the permission first.
 */
async function cachedExtras(
  ids: readonly SeasonId[],
): Promise<[SeasonId, ReportExtras][]> {
  "use cache";
  cacheLife(OWNER_DASHBOARD_LIFE);
  cacheTag(OWNER_DASHBOARD_TAG, ...ids.map((id) => seasonTag(id)));
  return [...(await reportExtras(db, ids))];
}

const NONE: ReportExtras = {
  surveyAverage: null,
  surveyAnswers: 0,
  sportsmanshipAverage: null,
  gamesPlayed: 0,
  rainedOut: 0,
};

export type Report = {
  league: Awaited<ReturnType<typeof ownerSeason>>["league"];
  season: { id: SeasonId; slug: string; name: string };
  current: SeasonFacts;
  previous: SeasonFacts | null;
};

/**
 * A season's report card and the season before it: the one past draft
 * that started just before. Only running or finished seasons have one.
 * The dashboard's numbers for both seasons and the extra reads go at once.
 */
export async function loadReport(slug: string): Promise<Report> {
  const { league, season, seasons } = await ownerSeason(slug);
  if (!REPORT_STATUSES.includes(season.status)) notFound();
  // Newest first, so the season before is the next one in the list.
  const previous = seasons[seasons.findIndex((s) => s.id === season.id) + 1];
  const ids = previous ? [season.id, previous.id] : [season.id];
  const [now, before, extras] = await Promise.all([
    cachedDashboard(league.id, season),
    previous ? cachedDashboard(league.id, previous) : Promise.resolve(null),
    cachedExtras(ids),
  ]);
  const extra = new Map(extras);
  return {
    league,
    season: { id: season.id, slug: season.slug, name: season.name },
    current: factsFrom(now.view, season, extra.get(season.id) ?? NONE),
    previous:
      previous && before
        ? factsFrom(before.view, previous, extra.get(previous.id) ?? NONE)
        : null,
  };
}
