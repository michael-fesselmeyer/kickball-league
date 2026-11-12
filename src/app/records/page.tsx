import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/db/client";
import { allPublishedGames } from "@/db/queries/public-schedule";
import { currentLeague } from "@/db/queries/seasons";
import { shortDay } from "@/domain/schedule/format";
import {
  leagueRecords,
  RECORD_TITLES,
  recordValue,
} from "@/domain/stats/records";
import { statGamesFrom, teamsFrom } from "@/domain/stats/season";

export const metadata: Metadata = {
  title: "League records",
  description:
    "The most runs, the biggest wins and the longest streaks in league history, updated after every final score.",
  alternates: { canonical: "/records" },
};

export default function RecordsPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-10 md:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1">
          League <span className="swipe">records</span>
        </h1>
        <p className="text-body-lg text-text-muted">
          The marks every team is chasing. A record stands until someone beats
          it; matching it gets you a nod, not the crown. Past champions are in{" "}
          <Link href="/history" className="underline">
            the league history
          </Link>
          .
        </p>
      </header>
      <Suspense fallback={<p>Loading the record book…</p>}>
        <Records />
      </Suspense>
    </main>
  );
}

async function Records() {
  const [games, league] = await Promise.all([
    allPublishedGames(db),
    currentLeague(db),
  ]);
  const timeZone = league?.timeZone ?? "America/New_York";
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
                  <TeamLink slug={team.slug} name={team.name} /> vs{" "}
                  <TeamLink slug={opponent.slug} name={opponent.name} />
                </>
              ) : (
                team && (
                  <>
                    <TeamLink slug={team.slug} name={team.name} />
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
                    href={`/games/${r.gameId}`}
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

function TeamLink({ slug, name }: { slug: string; name: string }) {
  return (
    <Link
      href={`/teams/${slug}`}
      className="inline-flex min-h-6 items-center font-bold underline"
    >
      {name}
    </Link>
  );
}
