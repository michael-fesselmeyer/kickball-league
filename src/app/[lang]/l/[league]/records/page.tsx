import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import { db } from "@/db/client";
import { allPublishedGames } from "@/db/queries/public-schedule";
import type { LeagueInfo } from "@/db/queries/leagues";
import { shortDay } from "@/domain/schedule/format";
import {
  leagueRecords,
  RECORD_TITLES,
  recordValue,
} from "@/domain/stats/records";
import { statGamesFrom, teamsFrom } from "@/domain/stats/season";
import { readUnlessBuildHasNoDatabase } from "@/lib/build-phase";
import { PUBLIC_PAGE_LIFE, seasonTag } from "@/lib/public-cache";
import { type LeagueRef, leagueHref } from "@/domain/league/paths";
import { publicLeague, withCanonical } from "@/lib/league/public";

/**
 * The page reads its league from the path outside any <Suspense> boundary,
 * so it has no generic fallback shell: a league the build didn't list, or a
 * page an admin's change just expired, is rendered in full before it is
 * served, then kept (as the game page does). Without this, expiring the
 * route makes its next visit fail (ADR 0048).
 */
export const instant = false;

const METADATA: Metadata = {
  title: "League records",
  description:
    "The most runs, the biggest wins and the longest streaks in league history, updated after every final score.",
};

export function generateMetadata({
  params,
}: PageProps<"/l/[league]/records">): Promise<Metadata> {
  return withCanonical(params, METADATA, "/records");
}

export default async function RecordsPage({
  params,
}: PageProps<"/l/[league]/records">) {
  const league = await publicLeague((await params).league, "/records");
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-10 md:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1">
          League <span className="swipe">records</span>
        </h1>
        <p className="text-body-lg text-text-muted">
          The marks every team is chasing. A record stands until someone beats
          it; matching it gets you a nod, not the crown. Past champions are in{" "}
          <Link href={leagueHref(league, "/history")} className="underline">
            the league history
          </Link>
          .
        </p>
      </header>
      <Records league={league} />
    </main>
  );
}

/**
 * Cached and part of the static page: a final score in any season expires
 * that season's tag, and with it this page.
 */
async function Records({ league }: { league: LeagueInfo }) {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  const games =
    (await readUnlessBuildHasNoDatabase(() =>
      allPublishedGames(db, league.id),
    )) ?? [];
  const seasonIds = [...new Set(games.map((g) => g.seasonId))];
  if (seasonIds.length > 0) cacheTag(...seasonIds.map(seasonTag));
  const timeZone = league.timeZone;
  const records = leagueRecords(statGamesFrom(games));
  const teams = teamsFrom(games);
  const seasons = new Map(
    games.map((g) => [g.seasonId, { name: g.seasonName, slug: g.seasonSlug }]),
  );

  if (records.length === 0)
    return (
      <p className="text-text-muted">
        The record book is empty until the first final score. Somebody has to go
        first.
      </p>
    );

  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {records.map((r) => {
        const team = r.team ? teams.get(r.team) : undefined;
        const opponent = r.opponent ? teams.get(r.opponent) : undefined;
        const season = seasons.get(r.seasonId);
        const isGame =
          r.key === "most_runs" ||
          r.key === "biggest_win" ||
          r.key === "highest_scoring";
        return (
          <li
            key={r.key}
            className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4 shadow-card"
          >
            <h2 className="text-micro font-bold tracking-wide text-text-muted uppercase">
              {RECORD_TITLES[r.key]}
            </h2>
            <p className="font-display text-h2">{recordValue(r)}</p>
            <p>
              {r.key === "highest_scoring" && team && opponent ? (
                <>
                  <TeamLink league={league} slug={team.slug} name={team.name} />{" "}
                  vs{" "}
                  <TeamLink
                    league={league}
                    slug={opponent.slug}
                    name={opponent.name}
                  />
                </>
              ) : (
                team && (
                  <>
                    <TeamLink
                      league={league}
                      slug={team.slug}
                      name={team.name}
                    />
                    {opponent && <> against {opponent.name}</>}
                  </>
                )
              )}
            </p>
            <p className="text-small text-text-muted">
              {season?.name}
              {isGame && (
                <>
                  {" · "}
                  <Link
                    href={leagueHref(league, `/games/${r.gameId}`)}
                    className="inline-flex min-h-6 items-center underline"
                  >
                    {shortDay(r.playedAt, timeZone)}
                  </Link>
                </>
              )}
              {r.matchedBy > 0 &&
                ` · Matched ${r.matchedBy} ${r.matchedBy === 1 ? "time" : "times"} since`}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

function TeamLink({
  league,
  slug,
  name,
}: {
  league: LeagueRef;
  slug: string;
  name: string;
}) {
  return (
    <Link
      href={leagueHref(league, `/teams/${slug}`)}
      className="inline-flex min-h-6 items-center font-bold underline"
    >
      {name}
    </Link>
  );
}
