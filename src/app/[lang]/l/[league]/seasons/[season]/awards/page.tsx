import type { Metadata } from "next";
import Link from "next/link";
import { cacheLife, cacheTag } from "next/cache";
import { notFound } from "next/navigation";
import { AwardsBoardView } from "@/components/stat-awards";
import { db } from "@/db/client";
import { awardsBoard } from "@/db/queries/stat-awards";
import { PUBLIC_PAGE_LIFE, seasonTag } from "@/lib/public-cache";
import type { LeagueInfo } from "@/db/queries/leagues";
import { leagueHref } from "@/domain/league/paths";
import { publicLeague, withCanonical } from "@/lib/league/public";
import {
  type LeagueParams,
  NO_SEASON,
  statAwardParams,
} from "@/lib/static-params";

const METADATA: Metadata = {
  title: "Season awards",
  description:
    "The season's stat awards and Season MVP, with every formula shown.",
};

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/l/[league]/seasons/[season]/awards">): Promise<Metadata> {
  const { season } = await params;
  return withCanonical(params, METADATA, `/seasons/${season}/awards`);
}

/** Whole page static, as the standings are (ADR 0029). */
export const ensureStatic = "navigation";

/** Each league's seasons with published awards are prerendered at build time. */
export async function generateStaticParams(props: LeagueParams) {
  return statAwardParams(props);
}

export default function AwardsPage(
  props: PageProps<"/[lang]/l/[league]/seasons/[season]/awards">,
) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <Awards {...props} />
    </main>
  );
}

async function Awards({
  params,
}: PageProps<"/[lang]/l/[league]/seasons/[season]/awards">) {
  const { league: segment, season: slug } = await params;
  const league = await publicLeague(segment, `/seasons/${slug}/awards`);
  // The build's placeholder when it had no awards to list.
  if (slug === NO_SEASON) notFound();
  return <SeasonAwards league={league} slug={slug} />;
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
 * season's tag, which publishing, taking down, a note and a player's
 * leaderboard opt-out expire.
 */
async function SeasonAwards({
  league,
  slug,
}: {
  league: LeagueInfo;
  slug: string;
}) {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  const found = await awardsBoard(
    db,
    { leagueId: league.id, seasonSlug: slug },
    { publishedOnly: true },
  );
  if (!found.found) notFound();
  cacheTag(seasonTag(found.seasonId));
  const board = found.board;
  // Hidden until an admin publishes them.
  if (!board?.publishedAt) notFound();

  return (
    <>
      <header className="flex flex-col gap-2">
        <p className="text-text-muted">{board.seasonName}</p>
        <h1 className="text-h1">Season awards</h1>
        <p>
          Worked out from what the league&apos;s app recorded this season:
          kicking orders, RSVPs, bar check-ins, live scores, sportsmanship
          ratings, sub spots and the players&apos; votes. Every formula is below
          its award. Players can choose to stay off this page.
        </p>
      </header>
      <AwardsBoardView board={board} />
      <p className="text-small text-text-muted">
        Published {date(board.publishedAt, board.timeZone)}. Runs are the
        team&apos;s runs in live-scored games the player played; the app
        doesn&apos;t record who kicked them in.{" "}
        <Link
          href={leagueHref(league, `/seasons/${board.seasonSlug}/standings`)}
          className="underline"
        >
          {board.seasonName} standings
        </Link>
      </p>
    </>
  );
}
