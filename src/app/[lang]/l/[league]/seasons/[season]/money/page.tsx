import type { Metadata } from "next";
import Link from "next/link";
import { cacheLife, cacheTag } from "next/cache";
import { notFound } from "next/navigation";
import { MoneySummaryView } from "@/components/money-summary";
import { db } from "@/db/client";
import { publicSummary } from "@/db/queries/owner-dashboard";
import { PUBLIC_PAGE_LIFE, seasonTag } from "@/lib/public-cache";
import {
  moneySummaryParams,
  NO_SEASON,
  type LeagueParams,
} from "@/lib/static-params";
import type { LeagueInfo } from "@/db/queries/leagues";
import { leagueHref } from "@/domain/league/paths";
import { publicLeague } from "@/lib/league/public";

export const metadata: Metadata = {
  title: "Where the money goes",
  description:
    "How the league spent the season's fees, by category, as the owners published it.",
};

/** Whole page static, as the standings are (ADR 0029). */
export const ensureStatic = "navigation";

/** Each published summary is prerendered at build time. */
export async function generateStaticParams(props: LeagueParams) {
  return moneySummaryParams(props);
}

export default function MoneyPage(
  props: PageProps<"/[lang]/l/[league]/seasons/[season]/money">,
) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <Money {...props} />
    </main>
  );
}

async function Money({
  params,
}: PageProps<"/[lang]/l/[league]/seasons/[season]/money">) {
  const { league: segment, season: slug } = await params;
  // The build's placeholder when it had no summary to list.
  if (slug === NO_SEASON) notFound();
  const league = await publicLeague(segment, `/seasons/${slug}/money`);
  return <SeasonMoney league={league} slug={slug} />;
}

const date = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone,
  }).format(d);

/**
 * Cached as static HTML (docs/architecture.md, section 3) under the
 * season's tag, which publishing or taking the summary down expires.
 */
async function SeasonMoney({
  league,
  slug,
}: {
  league: LeagueInfo;
  slug: string;
}) {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  const found = await publicSummary(db, league.id, slug);
  if (!found) notFound();
  cacheTag(seasonTag(found.seasonId));
  // Off by default: a season shows a summary only once an owner publishes it.
  if (!found.summary || !found.publishedAt) notFound();

  return (
    <>
      <header className="flex flex-col gap-2">
        <p className="text-text-muted">{found.name}</p>
        <h1 className="text-h1">Where the money goes</h1>
        <p>
          The league&apos;s owners share how this season&apos;s money was spent,
          in category totals. It never shows what any one person paid.
        </p>
      </header>
      <MoneySummaryView summary={found.summary} />
      <p className="text-small text-text-muted">
        Published {date(found.publishedAt, found.timeZone)}. Totals come from
        the league&apos;s books: payments made in the app or recorded by a
        captain or admin, less refunds, and the expenses the owners entered.{" "}
        <Link
          href={leagueHref(league, `/seasons/${found.slug}/standings`)}
          className="underline"
        >
          {found.name} standings
        </Link>
      </p>
    </>
  );
}
