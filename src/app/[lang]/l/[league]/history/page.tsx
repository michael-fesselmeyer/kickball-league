import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import { LogoBadge } from "@/components/logo-badge";
import { db } from "@/db/client";
import { type AllTimeRow, leagueHistory } from "@/db/queries/history";
import { shirtArchive } from "@/db/queries/shirt-late";
import type { LeagueInfo } from "@/db/queries/leagues";
import type { ArchiveSeason as ShirtArchiveSeason } from "@/db/queries/shirt-late";
import type { StandingsTeam } from "@/db/queries/standings";
import type { Hex } from "@/domain/color/contrast";
import {
  pctText,
  recordLine,
  seasonDates,
  signedText,
} from "@/domain/history/history";
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
  title: "League history",
  description:
    "Every finished season with its champion and final standings, and the all-time table of wins, losses, ties and titles.",
};

export function generateMetadata({
  params,
}: PageProps<"/[lang]/l/[league]/history">): Promise<Metadata> {
  return withCanonical(params, METADATA, "/history");
}

export default async function HistoryPage({
  params,
}: PageProps<"/[lang]/l/[league]/history">) {
  const league = await publicLeague((await params).league, "/history");
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
      <History league={league} />
    </main>
  );
}

/**
 * Cached and part of the static page: any change to a public season's
 * results expires that season's tag, and with it this page.
 */
async function History({ league }: { league: LeagueInfo }) {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  const [history, shirts] = await Promise.all([
    readUnlessBuildHasNoDatabase(() => leagueHistory(db, league.id)),
    readUnlessBuildHasNoDatabase(() => shirtArchive(db, league.id)),
  ]);
  const { pastSeasons, allTime, seasonIds } = history ?? {
    pastSeasons: [],
    allTime: [],
    seasonIds: [],
  };
  const archive = shirts ?? [];
  const tagged = [
    ...new Set([...seasonIds, ...archive.map((a) => a.seasonId)]),
  ];
  if (tagged.length > 0) cacheTag(...tagged.map(seasonTag));

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
                      <TeamLink league={league} team={s.champion} bold />
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

      <AllTimeTable league={league} rows={allTime} />

      <ShirtArchive league={league} archive={archive} />

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
                          {r.team ? (
                            <TeamLink league={league} team={r.team} />
                          ) : (
                            "Team"
                          )}
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
                href={leagueHref(league, `/seasons/${s.slug}/standings`)}
                className="inline-flex min-h-11 items-center text-brand underline"
              >
                {s.name} standings in full
              </Link>
              <Link
                href={leagueHref(league, `/seasons/${s.slug}/schedule`)}
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
        <Link href={leagueHref(league, "/records")} className="underline">
          See the league records
        </Link>
        .
      </p>
    </>
  );
}

/** Each season's team shirts: the design a captain described, or own shirts. */
function ShirtArchive({
  league,
  archive,
}: {
  league: LeagueRef;
  archive: ShirtArchiveSeason[];
}) {
  if (archive.length === 0) return null;
  return (
    <section aria-labelledby="shirt-archive" className="flex flex-col gap-4">
      <h2 id="shirt-archive" className="text-h2">
        Shirt archive
      </h2>
      {archive.map((s) => (
        <section
          key={s.seasonId}
          aria-labelledby={`shirts-${s.slug}`}
          className="flex flex-col gap-2"
        >
          <h3 id={`shirts-${s.slug}`} className="text-h3">
            {s.name}
          </h3>
          <ul className="flex flex-col gap-2">
            {s.teams.map((t) => (
              <li key={t.slug} className="flex items-start gap-2">
                <span className="mt-1.5">
                  <Swatch color={t.colorHex} />
                </span>
                <span>
                  <Link
                    href={leagueHref(league, `/teams/${t.slug}`)}
                    className="inline-flex min-h-6 items-center font-bold underline"
                  >
                    {t.name}
                  </Link>
                  <span className="block text-small text-text-muted">
                    {t.design ?? "Wore its own shirts or jerseys that season."}
                    {t.design && t.ownShirts && " Own shirts."}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}

function AllTimeTable({
  league,
  rows,
}: {
  league: LeagueRef;
  rows: AllTimeRow[];
}) {
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
                    {r.info ? (
                      <TeamLink league={league} team={r.info} />
                    ) : (
                      r.team
                    )}
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

function TeamLink({
  league,
  team,
  bold,
}: {
  league: LeagueRef;
  team: StandingsTeam;
  bold?: boolean;
}) {
  return (
    <Link
      href={leagueHref(league, `/teams/${team.slug}`)}
      className={`inline-flex min-h-6 items-center underline ${bold ? "font-bold" : ""}`}
    >
      {team.name}
    </Link>
  );
}
