import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LogoBadge } from "@/components/logo-badge";
import { db } from "@/db/client";
import { type AllTimeRow, leagueHistory } from "@/db/queries/history";
import { currentLeague } from "@/db/queries/seasons";
import type { StandingsTeam } from "@/db/queries/standings";
import type { Hex } from "@/domain/color/contrast";
import {
  pctText,
  recordLine,
  seasonDates,
  signedText,
} from "@/domain/history/history";

export const metadata: Metadata = {
  title: "League history",
  description:
    "Every finished season with its champion and final standings, and the all-time table of wins, losses, ties and titles.",
  alternates: { canonical: "/history" },
};

export default function HistoryPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 py-10 md:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1">
          League <span className="swipe">history</span>
        </h1>
        <p className="text-body-lg text-text-muted">
          Every season that made it to the final out: who took the crown, how
          the table finished, and who has won the most since day one.
        </p>
      </header>
      <Suspense fallback={<p>Digging through the archives…</p>}>
        <History />
      </Suspense>
    </main>
  );
}

async function History() {
  const league = await currentLeague(db);
  const { pastSeasons, allTime } = league
    ? await leagueHistory(db, league.id)
    : { pastSeasons: [], allTime: [] };

  if (pastSeasons.length === 0)
    return (
      <p className="text-text-muted">
        No season has finished yet. The first champion goes up here as soon as
        the last out is recorded.
      </p>
    );

  return (
    <>
      <section aria-labelledby="champions" className="flex flex-col gap-4">
        <h2 id="champions" className="text-h2">
          Champions
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {pastSeasons.map((s) => {
            const row = s.standings.find((r) => r.teamId === s.champion?.slug);
            return (
              <li
                key={s.id}
                className="flex items-center gap-3 rounded-card border-2 border-text bg-surface p-4 shadow-sticker"
              >
                {s.champion ? (
                  <>
                    <LogoBadge
                      kind="team"
                      name={s.champion.name}
                      color={s.champion.colorHex as Hex | null}
                      size={64}
                    />
                    <div className="flex min-w-0 flex-col">
                      <p className="text-micro font-bold tracking-wide text-text-muted uppercase">
                        {s.name}
                      </p>
                      <TeamLink team={s.champion} bold />
                      {row && (
                        <p className="text-small text-text-muted tabular-nums">
                          {recordLine(row)}
                        </p>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col">
                    <p className="text-micro font-bold tracking-wide text-text-muted uppercase">
                      {s.name}
                    </p>
                    <p className="text-text-muted">No champion crowned</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <AllTimeTable rows={allTime} />

      <section aria-labelledby="seasons" className="flex flex-col gap-8">
        <h2 id="seasons" className="text-h2">
          Final standings
        </h2>
        {pastSeasons.map((s) => (
          <section
            key={s.id}
            aria-labelledby={`season-${s.slug}`}
            className="flex flex-col gap-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
              <h3 id={`season-${s.slug}`} className="text-h3">
                {s.name}
              </h3>
              <p className="text-small text-text-muted">
                {seasonDates(s.startsOn, s.endsOn)}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left tabular-nums [&_:is(td,th)+:is(td,th)]:pl-3">
                <caption className="sr-only">
                  {s.name} final standings: wins, losses, ties and run
                  difference
                </caption>
                <thead className="text-small text-text-muted">
                  <tr>
                    <th scope="col" className="py-2 pr-2">
                      <abbr title="Rank">#</abbr>
                    </th>
                    <th scope="col">Team</th>
                    <th scope="col" className="text-right">
                      <abbr title="Wins">W</abbr>
                    </th>
                    <th scope="col" className="text-right">
                      <abbr title="Losses">L</abbr>
                    </th>
                    <th scope="col" className="text-right">
                      <abbr title="Ties">T</abbr>
                    </th>
                    <th scope="col" className="hidden text-right sm:table-cell">
                      <abbr title="Win percentage, a tie counting as half a win">
                        PCT
                      </abbr>
                    </th>
                    <th scope="col" className="text-right">
                      <abbr title="Run difference, capped at 10 a game">
                        DIFF
                      </abbr>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {s.standings.map((r) => (
                    <tr key={r.teamId} className="border-t border-border">
                      <td className="py-2 pr-2 text-text-muted">{r.rank}</td>
                      <th scope="row" className="font-normal">
                        <span className="flex flex-wrap items-center gap-2">
                          <Swatch color={r.team?.colorHex ?? null} />
                          {r.team ? <TeamLink team={r.team} /> : "Team"}
                          {r.teamId === s.champion?.slug && (
                            <span className="sticker text-micro">Champs</span>
                          )}
                        </span>
                      </th>
                      <td className="text-right">{r.wins}</td>
                      <td className="text-right">{r.losses}</td>
                      <td className="text-right">{r.ties}</td>
                      <td className="hidden text-right sm:table-cell">
                        {pctText(r.winPct)}
                      </td>
                      <td className="text-right">
                        {signedText(r.runDifference)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="flex flex-wrap gap-x-4 text-small">
              <Link
                href={`/seasons/${s.slug}/standings`}
                className="inline-flex min-h-11 items-center text-brand underline"
              >
                {s.name} standings in full
              </Link>
              <Link
                href={`/seasons/${s.slug}/schedule`}
                className="inline-flex min-h-11 items-center text-brand underline"
              >
                {s.name} results
              </Link>
            </p>
          </section>
        ))}
      </section>

      <p className="text-small text-text-muted">
        The all-time table counts regular-season games in every season,
        including the one being played; titles count finished seasons. Looking
        for the biggest wins and longest streaks?{" "}
        <Link href="/records" className="underline">
          See the league records
        </Link>
        .
      </p>
    </>
  );
}

function AllTimeTable({ rows }: { rows: AllTimeRow[] }) {
  return (
    <section aria-labelledby="all-time" className="flex flex-col gap-3">
      <h2 id="all-time" className="text-h2">
        All-time table
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left tabular-nums [&_:is(td,th)+:is(td,th)]:pl-3">
          <caption className="sr-only">
            Every team&apos;s all-time record: titles, seasons, wins, losses,
            ties, win percentage and run difference
          </caption>
          <thead className="text-small text-text-muted">
            <tr>
              <th scope="col" className="py-2 pr-2">
                Team
              </th>
              <th scope="col" className="text-right">
                Titles
              </th>
              <th scope="col" className="hidden text-right sm:table-cell">
                Seasons
              </th>
              <th scope="col" className="text-right">
                <abbr title="Wins, losses and ties">W-L-T</abbr>
              </th>
              <th scope="col" className="hidden text-right sm:table-cell">
                <abbr title="Win percentage, a tie counting as half a win">
                  PCT
                </abbr>
              </th>
              <th scope="col" className="text-right">
                <abbr title="Run difference, capped at 10 a game">DIFF</abbr>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.team} className="border-t border-border">
                <th scope="row" className="py-2 pr-2 font-normal">
                  <span className="flex items-center gap-2">
                    <Swatch color={r.info?.colorHex ?? null} />
                    {r.info ? <TeamLink team={r.info} /> : r.team}
                  </span>
                </th>
                <td className="text-right font-bold">
                  {r.titles > 0 ? r.titles : "–"}
                </td>
                <td className="hidden text-right sm:table-cell">{r.seasons}</td>
                <td className="text-right whitespace-nowrap">
                  {recordLine(r)}
                </td>
                <td className="hidden text-right sm:table-cell">
                  {pctText(r.winPct)}
                </td>
                <td className="text-right">{signedText(r.runDifference)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Swatch({ color }: { color: string | null }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-3 shrink-0 rounded-full border border-border"
      style={{ background: color ?? "transparent" }}
    />
  );
}

function TeamLink({ team, bold }: { team: StandingsTeam; bold?: boolean }) {
  return (
    <Link
      href={`/teams/${team.slug}`}
      className={`inline-flex min-h-6 items-center underline ${bold ? "font-bold" : ""}`}
    >
      {team.name}
    </Link>
  );
}
