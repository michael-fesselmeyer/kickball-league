import { cacheLife, cacheTag } from "next/cache";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import {
  type DashboardSeasonRow,
  dashboardSeasons,
  ownerDashboard,
  summaryInputs,
} from "@/db/queries/owner-dashboard";
import { currentLeague } from "@/db/queries/seasons";
import {
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
} from "@/domain/books/ledger";
import {
  buildMoneySummary,
  publishBlocker,
  seasonFees,
  seasonMoney,
} from "@/domain/dashboard/money";
import {
  buildDashboardView,
  type DashboardView,
} from "@/domain/dashboard/view";
import type { LeagueId, SeasonId } from "@/domain/ids";
import {
  OWNER_DASHBOARD_LIFE,
  OWNER_DASHBOARD_TAG,
} from "@/lib/owner-dashboard-cache";
import { seasonTag } from "@/lib/public-cache";

/**
 * The league and the season an owner screen is about, from the path. Call
 * after the permission check. Unknown and draft seasons are a 404.
 */
export async function ownerSeason(slug: string) {
  const league = await currentLeague(db);
  if (!league) notFound();
  const seasons = await dashboardSeasons(db, league.id);
  const season = seasons.find((s) => s.slug === slug);
  if (!season) notFound();
  return { league, season, seasons };
}

/** The newest season past draft, where /app/owner lands. */
export async function newestOwnerSeason(): Promise<string | null> {
  const league = await currentLeague(db);
  if (!league) return null;
  return (await dashboardSeasons(db, league.id))[0]?.slug ?? null;
}

export type CachedDashboard = {
  view: DashboardView;
  /** When these numbers were read. */
  readAt: Date;
  /** When the season's money summary was published, if it is. */
  publishedAt: Date | null;
};

/**
 * The dashboard's numbers for a season, cached (OWNER_DASHBOARD_LIFE). Takes
 * only ids and dates, never the request, so callers check the permission
 * first.
 */
export async function cachedDashboard(
  leagueId: LeagueId,
  selected: { id: SeasonId; startsOn: string; endsOn: string },
): Promise<CachedDashboard> {
  "use cache";
  cacheLife(OWNER_DASHBOARD_LIFE);
  cacheTag(OWNER_DASHBOARD_TAG);
  const data = await ownerDashboard(db, leagueId, selected);
  for (const s of data.seasons) cacheTag(seasonTag(s.id));
  return {
    view: buildDashboardView(data, selected),
    readAt: new Date(),
    publishedAt: data.published?.publishedAt ?? null,
  };
}

/**
 * A season's money summary as it would be published now, with the
 * categories `folded` into "Other" (or those the published one folds),
 * and why it can't be published, if so. Built from the live numbers, never
 * from anything a form sends back.
 */
export async function liveSummary(
  leagueId: LeagueId,
  season: DashboardSeasonRow,
  fold: readonly ExpenseCategory[] | "as_published",
) {
  const inputs = await summaryInputs(db, leagueId, season.id);
  const money = seasonMoney({ seasonId: season.id, ...inputs });
  const folded =
    fold === "as_published" ? (inputs.published?.folded ?? []) : fold;
  const summary = buildMoneySummary(money, seasonFees(season), folded);
  return {
    summary,
    folded,
    money,
    members: inputs.members,
    published: inputs.published,
    blocker: publishBlocker({ members: inputs.members, summary }),
  };
}

/** The categories a form or query string asks to fold, known ones only. */
export function foldedFrom(values: readonly unknown[]): ExpenseCategory[] {
  return FOLDABLE.filter((c) => values.includes(c));
}

/** Every category but "Other" can be folded into "Other". */
export const FOLDABLE = EXPENSE_CATEGORIES.filter((c) => c !== "other");
