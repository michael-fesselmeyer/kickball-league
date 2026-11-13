import type { Metadata } from "next";
import Link from "next/link";
import { cacheLife, cacheTag } from "next/cache";
import { notFound } from "next/navigation";
import { Morph, teamMorph } from "@/components/motion";
import { StandingsStats } from "@/components/stats/standings-stats";
import { db } from "@/db/client";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { seasonStandings } from "@/db/queries/standings";
import type { Tiebreaker } from "@/domain/standings/standings";
import { PUBLIC_PAGE_LIFE, seasonTag } from "@/lib/public-cache";
import { NO_SEASON, publicSeasonParams } from "@/lib/static-params";

export const metadata: Metadata = { title: "Standings" };

/**
 * The whole page is static, and a view the build didn't list is rendered in
 * full on its first visit instead of streaming in behind a loading state.
 * Without a <Suspense> boundary around it, the table is part of the first
 * paint: React moves a finished boundary larger than its progressive chunk
 * (12.8 kB) to the end of the document, and the browser could paint the
 * fallback first and reveal the table up to 300 ms later.
 */
export const ensureStatic = "navigation";

/** Each public season's standings are prerendered at build time. */
export async function generateStaticParams() {
  return publicSeasonParams();
}

export default function StandingsPage(
  props: PageProps<"/seasons/[season]/standings">,
) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10">
      <Standings {...props} />
    </main>
  );
}

const SEPARATED: Record<Tiebreaker, string> = {
  win_pct: "",
  head_to_head: "head-to-head",
  run_difference: "run difference",
  runs_allowed: "runs allowed",
  coin_flip: "coin flip",
};

/** ".750"; a perfect record reads "1.000". */
const pct = (n: number) => (n === 1 ? "1.000" : n.toFixed(3).replace(/^0/, ""));
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

async function Standings({ params }: PageProps<"/seasons/[season]/standings">) {
  const { season: slug } = await params;
  // The build's placeholder when it had no database to read.
  if (slug === NO_SEASON) notFound();
  return <SeasonStandings slug={slug} />;
}

/**
 * Cached, so after the first visit the page is served as static HTML with the
 * table in the first paint (docs/architecture.md, section 3).
 */
async function SeasonStandings({ slug }: { slug: string }) {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  const season = await seasonBySlug(db, slug);
  // Drafts are the league's work in progress, not public.
  if (!season || season.status === "draft") notFound();
  cacheTag(seasonTag(season.id));
  const { rows, teams } = await seasonStandings(db, season.id);
  // Rows a tiebreaker (not just win percentage) placed below the row above.
  const notes = rows.flatMap((r) =>
    r.separatedBy && r.separatedBy !== "win_pct"
      ? [{ teamId: r.teamId, by: r.separatedBy }]
      : [],
  );
  const played = rows.some((r) => r.played > 0);

  return (
    <>
      <header className="flex flex-col gap-1">
        <p className="text-text-muted">{season.name}</p>
        <h1 className="text-h1">Standings</h1>
        <nav aria-label="Season" className="flex flex-wrap gap-x-4 gap-y-1">
          <Link
            href={`/seasons/${season.slug}/schedule`}
            className="inline-flex min-h-11 items-center text-brand underline"
          >
            Schedule
          </Link>
          <Link
            href={`/seasons/${season.slug}/bracket`}
            className="inline-flex min-h-11 items-center text-brand underline"
          >
            Playoffs
          </Link>
        </nav>
      </header>
      {!played && (
        <p className="text-text-muted">
          No games played yet. The table fills in as scores come in.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left tabular-nums">
          <caption className="sr-only">
            {season.name} standings: wins, losses, ties, win percentage, runs
            and recent form
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
              <th scope="col" className="hidden text-right sm:table-cell">
                <abbr title="Runs scored">RF</abbr>
              </th>
              <th scope="col" className="hidden text-right sm:table-cell">
                <abbr title="Runs allowed">RA</abbr>
              </th>
              <th scope="col" className="text-right">
                <abbr title="Run difference, capped at 10 a game">DIFF</abbr>
              </th>
              <th scope="col" className="hidden text-right md:table-cell">
                <abbr title="Current streak">STRK</abbr>
              </th>
              <th scope="col" className="hidden text-right md:table-cell">
                <abbr title="Last five games, oldest first">L5</abbr>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const t = teams.get(r.teamId);
              return (
                <tr key={r.teamId} className="border-t border-border">
                  <td className="py-2 pr-2 text-text-muted">{r.rank}</td>
                  <th scope="row" className="font-normal">
                    <span className="flex items-center gap-2">
                      <Morph name={teamMorph(r.teamId)}>
                        <span
                          aria-hidden="true"
                          className="inline-block size-3 shrink-0 rounded-full border border-border"
                          style={{ background: t?.colorHex ?? "transparent" }}
                        />
                      </Morph>
                      {t ? (
                        <Link
                          href={`/teams/${t.slug}`}
                          className="inline-flex min-h-6 items-center underline"
                        >
                          {t.name}
                        </Link>
                      ) : (
                        "Team"
                      )}
                    </span>
                  </th>
                  <td className="text-right">{r.wins}</td>
                  <td className="text-right">{r.losses}</td>
                  <td className="text-right">{r.ties}</td>
                  <td className="hidden text-right sm:table-cell">
                    {pct(r.winPct)}
                  </td>
                  <td className="hidden text-right sm:table-cell">
                    {r.runsFor}
                  </td>
                  <td className="hidden text-right sm:table-cell">
                    {r.runsAgainst}
                  </td>
                  <td className="text-right">{signed(r.runDifference)}</td>
                  <td className="hidden text-right md:table-cell">
                    {r.streak || "–"}
                  </td>
                  <td className="hidden text-right font-mono md:table-cell">
                    {r.lastFive || "–"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {notes.length > 0 && (
        <section aria-labelledby="tiebreakers" className="flex flex-col gap-1">
          <h2 id="tiebreakers" className="text-h3">
            Tiebreakers
          </h2>
          <ul className="text-small text-text-muted">
            {notes.map((r) => (
              <li key={r.teamId}>
                {teams.get(r.teamId)?.name} placed below the team above on{" "}
                {SEPARATED[r.by]}.
              </li>
            ))}
          </ul>
        </section>
      )}
      <StandingsStats season={season} teams={[...teams.values()]} />
      <p className="text-small text-text-muted">
        A tie counts as half a win. Ties in the table are broken by
        head-to-head, then run difference (capped at 10 a game), then runs
        allowed, then a coin flip.{" "}
        <Link href="/" className="underline">
          Home
        </Link>
      </p>
    </>
  );
}
