import type { Metadata } from "next";
import Link from "next/link";
import { cacheLife, cacheTag } from "next/cache";
import { notFound } from "next/navigation";
import { Morph, teamMorph } from "@/components/motion";
import { StandingsStats } from "@/components/stats/standings-stats";
import { db } from "@/db/client";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import {
  seasonDivisionStandings,
  type StandingsTeam,
} from "@/db/queries/standings";
import { ruleSetSummary } from "@/domain/season/divisions";
import type { StandingsRow } from "@/domain/standings/standings";
import { type SportRules, sportRules } from "@/domain/sports/sports";
import { PUBLIC_PAGE_LIFE, seasonTag } from "@/lib/public-cache";
import {
  NO_SEASON,
  publicSeasonParams,
  type LeagueParams,
} from "@/lib/static-params";
import type { LeagueInfo } from "@/db/queries/leagues";
import { type LeagueRef, leagueHref } from "@/domain/league/paths";
import { publicLeague } from "@/lib/league/public";
import { isPublicSeason } from "@/domain/private-events/visibility";

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
export async function generateStaticParams(props: LeagueParams) {
  return publicSeasonParams(props);
}

export default function StandingsPage(
  props: PageProps<"/[lang]/l/[league]/seasons/[season]/standings">,
) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10">
      <Standings {...props} />
    </main>
  );
}

/** ".750"; a perfect record reads "1.000". */
const pct = (n: number) => (n === 1 ? "1.000" : n.toFixed(3).replace(/^0/, ""));
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

async function Standings({
  params,
}: PageProps<"/[lang]/l/[league]/seasons/[season]/standings">) {
  const { league: segment, season: slug } = await params;
  // The build's placeholder when it had no database to read.
  if (slug === NO_SEASON) notFound();
  const league = await publicLeague(segment, `/seasons/${slug}/standings`);
  return <SeasonStandings league={league} slug={slug} />;
}

/**
 * Cached, so after the first visit the page is served as static HTML with the
 * table in the first paint (docs/architecture.md, section 3).
 */
async function SeasonStandings({
  league,
  slug,
}: {
  league: LeagueInfo;
  slug: string;
}) {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  const season = await seasonBySlug(db, league.id, slug);
  // Drafts are the league's work in progress, not public.
  if (!season || !isPublicSeason(season)) notFound();
  cacheTag(seasonTag(season.id));
  const { tables, teams, crossoversCount, sport } =
    await seasonDivisionStandings(db, season.id);
  // The sport names the units and tiebreakers (ADR 0087).
  const rules = sportRules(sport);
  const units = rules.score.unit.many;
  const cap = rules.score.differenceCap;
  const divided = tables.some((t) => t.division !== null);
  // Rows a tiebreaker (not just win percentage) placed below the row above.
  const notes = tables.flatMap((t) =>
    t.rows.flatMap((r) =>
      r.separatedBy && r.separatedBy !== "win_pct"
        ? [{ teamId: r.teamId, by: r.separatedBy }]
        : [],
    ),
  );
  const played = tables.some((t) => t.rows.some((r) => r.played > 0));

  return (
    <>
      <header className="flex flex-col gap-1">
        <p className="text-text-muted">{season.name}</p>
        <h1 className="text-h1">Standings</h1>
        <nav aria-label="Season" className="flex flex-wrap gap-x-4 gap-y-1">
          <Link
            href={leagueHref(league, `/seasons/${season.slug}/schedule`)}
            className="inline-flex min-h-11 items-center text-brand underline"
          >
            Schedule
          </Link>
          <Link
            href={leagueHref(league, `/seasons/${season.slug}/bracket`)}
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
      {divided ? (
        tables.map((t, i) => {
          const id = `division-${t.division?.slug ?? `none-${i}`}`;
          const name = t.division?.name ?? "No division";
          return (
            <section
              key={id}
              aria-labelledby={id}
              className="flex flex-col gap-2"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                <h2 id={id} className="text-h2">
                  {name}
                </h2>
                {t.division && (
                  <Link
                    href={leagueHref(
                      league,
                      `/seasons/${season.slug}/schedule/division/${t.division.slug}`,
                    )}
                    className="inline-flex min-h-11 items-center text-brand underline"
                  >
                    {name} schedule
                  </Link>
                )}
              </div>
              {t.division?.ruleSet && ruleSetSummary(t.division.ruleSet) && (
                <p className="text-small text-text-muted">
                  {t.division.ruleSet.name}:{" "}
                  {ruleSetSummary(t.division.ruleSet)}
                </p>
              )}
              <StandingsTable
                league={league}
                rows={t.rows}
                teams={teams}
                rules={rules}
                caption={`${season.name} ${name} standings: wins, losses, ties, win percentage, ${units} and recent form`}
              />
            </section>
          );
        })
      ) : (
        <StandingsTable
          league={league}
          rows={tables[0]?.rows ?? []}
          teams={teams}
          rules={rules}
          caption={`${season.name} standings: wins, losses, ties, win percentage, ${units} and recent form`}
        />
      )}
      {notes.length > 0 && (
        <section aria-labelledby="tiebreakers" className="flex flex-col gap-1">
          <h2 id="tiebreakers" className="text-h3">
            Tiebreakers
          </h2>
          <ul className="text-small text-text-muted">
            {notes.map((r) => (
              <li key={r.teamId}>
                {teams.get(r.teamId)?.name} placed below the team above on{" "}
                {rules.tiebreakers[r.by]}.
              </li>
            ))}
          </ul>
        </section>
      )}
      <StandingsStats
        league={league}
        season={season}
        teams={[...teams.values()]}
      />
      <p className="text-small text-text-muted">
        A tie counts as half a win. Ties in the table are broken by
        head-to-head, then {rules.tiebreakers.run_difference}
        {cap !== null && ` (capped at ${cap} a game)`}, then{" "}
        {rules.tiebreakers.runs_allowed}, then a coin flip.{" "}
        {divided &&
          (crossoversCount
            ? "Each team is ranked within its division, and games against the other division count toward its record. "
            : "Each team is ranked within its division on its division games only. ")}
        <Link href={leagueHref(league, "/")} className="underline">
          Home
        </Link>
      </p>
    </>
  );
}

/** One standings table, in rank order. */
function StandingsTable({
  league,
  rows,
  teams,
  rules,
  caption,
}: {
  league: LeagueRef;
  rows: StandingsRow[];
  teams: Map<string, StandingsTeam>;
  rules: SportRules;
  caption: string;
}) {
  const unit = rules.score.unit;
  const units = `${unit.many[0]?.toUpperCase()}${unit.many.slice(1)}`;
  const cap = rules.score.differenceCap;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left tabular-nums">
        <caption className="sr-only">{caption}</caption>
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
              <abbr title={`${units} scored`}>{unit.letter}F</abbr>
            </th>
            <th scope="col" className="hidden text-right sm:table-cell">
              <abbr title={`${units} allowed`}>{unit.letter}A</abbr>
            </th>
            <th scope="col" className="text-right">
              <abbr
                title={`${unit.one[0]?.toUpperCase()}${unit.one.slice(1)} difference${cap === null ? "" : `, capped at ${cap} a game`}`}
              >
                DIFF
              </abbr>
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
                        href={leagueHref(league, `/teams/${t.slug}`)}
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
                <td className="hidden text-right sm:table-cell">{r.runsFor}</td>
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
  );
}
