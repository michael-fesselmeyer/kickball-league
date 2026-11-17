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
import type { LeagueId } from "@/domain/ids";
import { ruleSetSummary } from "@/domain/season/divisions";
import type { StandingsRow, Tiebreaker } from "@/domain/standings/standings";
import { type SportRules, sportRules } from "@/domain/sports/sports";
import { PUBLIC_PAGE_LIFE, seasonTag } from "@/lib/public-cache";
import {
  NO_SEASON,
  publicSeasonParams,
  type LeagueParams,
} from "@/lib/static-params";
import type { LeagueInfo } from "@/db/queries/leagues";
import { type LeagueRef, leagueHref } from "@/domain/league/paths";
import { cachedLeague, publicLeague } from "@/lib/league/public";
import { isPublicSeason } from "@/domain/private-events/visibility";
import { outcomeLetters } from "@/domain/stats/streaks";
import { fill } from "@/i18n/catalog";
import type { Locale } from "@/i18n/locales";
import { localeOf, type Messages, messagesFor } from "@/i18n/messages";
import { languageAlternates, linkIn } from "@/i18n/routing";

type Props = PageProps<"/[lang]/l/[league]/seasons/[season]/standings">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, league: segment, season: slug } = await params;
  const locale = localeOf(lang);
  const words = messagesFor(locale).standings;
  const title = words.title;
  if (slug === NO_SEASON) return { title };
  const league = await cachedLeague(segment);
  if (!league) return { title };
  const path = leagueHref(league, `/seasons/${slug}/standings`);
  const season = await cachedSeasonName(league.id, slug);
  return {
    // Unique per season (WCAG 2.4.2), and the same as the h1.
    title: season ? fill(words.seasonTitle, { season }) : title,
    alternates: {
      canonical: linkIn(locale, path),
      languages: languageAlternates(path),
    },
  };
}

/** A public season's name, for the title; null for a draft or none. */
async function cachedSeasonName(leagueId: LeagueId, slug: string) {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  const season = await seasonBySlug(db, leagueId, slug);
  if (!season) return null;
  cacheTag(seasonTag(season.id));
  return isPublicSeason(season) ? season.name : null;
}

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

export default function StandingsPage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10">
      <Standings {...props} />
    </main>
  );
}

/** ".750"; a perfect record reads "1.000". */
const pct = (n: number) => (n === 1 ? "1.000" : n.toFixed(3).replace(/^0/, ""));
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

async function Standings({ params }: Props) {
  const { league: segment, season: slug, lang } = await params;
  // The build's placeholder when it had no database to read.
  if (slug === NO_SEASON) notFound();
  const league = await publicLeague(segment, `/seasons/${slug}/standings`);
  return (
    <SeasonStandings league={league} slug={slug} locale={localeOf(lang)} />
  );
}

/**
 * Cached, so after the first visit the page is served as static HTML with the
 * table in the first paint (docs/architecture.md, section 3).
 */
async function SeasonStandings({
  league,
  slug,
  locale,
}: {
  league: LeagueInfo;
  slug: string;
  locale: Locale;
}) {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  const words = messagesFor(locale).standings;
  const href = (path: string) => linkIn(locale, leagueHref(league, path));
  const season = await seasonBySlug(db, league.id, slug);
  // Drafts are the league's work in progress, not public.
  if (!season || !isPublicSeason(season)) notFound();
  cacheTag(seasonTag(season.id));
  const {
    tables,
    teams,
    crossoversCount,
    sport: sportKey,
  } = await seasonDivisionStandings(db, season.id);
  // The sport names the units and tiebreakers (ADR 0087).
  const rules = sportRules(sportKey);
  const sport = messagesFor(locale).sports[rules.key];
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
        <h1 className="text-h1">
          {fill(words.seasonTitle, { season: season.name })}
        </h1>
        <nav
          aria-label={words.seasonNav}
          className="flex flex-wrap gap-x-4 gap-y-1"
        >
          <Link
            href={href(`/seasons/${season.slug}/schedule`)}
            className="inline-flex min-h-11 items-center text-brand underline"
          >
            {words.schedule}
          </Link>
          <Link
            href={href(`/seasons/${season.slug}/bracket`)}
            className="inline-flex min-h-11 items-center text-brand underline"
          >
            {words.playoffs}
          </Link>
        </nav>
      </header>
      {!played && <p className="text-text-muted">{words.noGames}</p>}
      {divided ? (
        tables.map((t, i) => {
          const id = `division-${t.division?.slug ?? `none-${i}`}`;
          const name = t.division?.name ?? words.noDivision;
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
                    href={href(
                      `/seasons/${season.slug}/schedule/division/${t.division.slug}`,
                    )}
                    className="inline-flex min-h-11 items-center text-brand underline"
                  >
                    {fill(words.divisionSchedule, { division: name })}
                  </Link>
                )}
              </div>
              {t.division?.ruleSet &&
                ruleSetSummary(t.division.ruleSet, locale) && (
                  <p className="text-small text-text-muted">
                    {t.division.ruleSet.name}:{" "}
                    {ruleSetSummary(t.division.ruleSet, locale)}
                  </p>
                )}
              <StandingsTable
                league={league}
                rows={t.rows}
                teams={teams}
                rules={rules}
                caption={fill(words.divisionCaption, {
                  season: season.name,
                  division: name,
                  units: sport.many,
                })}
                locale={locale}
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
          caption={fill(words.caption, {
            season: season.name,
            units: sport.many,
          })}
          locale={locale}
        />
      )}
      {notes.length > 0 && (
        <section aria-labelledby="tiebreakers" className="flex flex-col gap-1">
          <h2 id="tiebreakers" className="text-h3">
            {words.tiebreakers}
          </h2>
          <ul className="text-small text-text-muted">
            {notes.map((r) => (
              <li key={r.teamId}>
                {fill(words.placedBelow, {
                  team: teams.get(r.teamId)?.name ?? words.team,
                  by: tiebreakerWords(words, sport)[r.by],
                })}
              </li>
            ))}
          </ul>
        </section>
      )}
      <StandingsStats
        league={league}
        season={season}
        teams={[...teams.values()]}
        locale={locale}
      />
      <p className="text-small text-text-muted">
        {fill(words.howRanked, {
          difference: sport.difference,
          capped: cap === null ? "" : fill(words.capped, { cap }),
          allowed: sport.allowed,
        })}{" "}
        {divided &&
          `${crossoversCount ? words.crossovers : words.divisionOnly} `}
        <Link href={href("/")} className="underline">
          {words.home}
        </Link>
      </p>
    </>
  );
}

/** "runs" → "Runs". */
const upperFirst = (text: string) =>
  `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** Each tiebreaker as the standings name it, in the sport's units. */
function tiebreakerWords(
  words: Messages["standings"],
  sport: Messages["sports"][keyof Messages["sports"]],
): Record<Exclude<Tiebreaker, "win_pct">, string> {
  return {
    head_to_head: words.by.head_to_head,
    run_difference: sport.difference,
    runs_allowed: sport.allowed,
    coin_flip: words.by.coin_flip,
  };
}

/** One standings table, in rank order. */
function StandingsTable({
  league,
  rows,
  teams,
  rules,
  caption,
  locale,
}: {
  league: LeagueRef;
  rows: StandingsRow[];
  teams: Map<string, StandingsTeam>;
  rules: SportRules;
  caption: string;
  locale: Locale;
}) {
  const words = messagesFor(locale).standings;
  const sport = messagesFor(locale).sports[rules.key];
  const cap = rules.score.differenceCap;
  const units = upperFirst(sport.many);
  const col = (key: keyof Messages["standings"]["columns"], title?: string) => (
    <abbr title={title ?? fill(words.columns[key].long, { Units: units })}>
      {fill(words.columns[key].short, { letter: sport.letter })}
    </abbr>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left tabular-nums [&_:is(td,th)+:is(td,th)]:pl-3">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-small text-text-muted">
          <tr>
            <th scope="col" className="py-2 pr-2">
              {col("rank")}
            </th>
            <th scope="col">{words.team}</th>
            <th scope="col" className="text-right">
              {col("wins")}
            </th>
            <th scope="col" className="text-right">
              {col("losses")}
            </th>
            <th scope="col" className="text-right">
              {col("ties")}
            </th>
            <th scope="col" className="hidden text-right sm:table-cell">
              {col("pct")}
            </th>
            <th scope="col" className="hidden text-right sm:table-cell">
              {col("runsFor")}
            </th>
            <th scope="col" className="hidden text-right sm:table-cell">
              {col("runsAgainst")}
            </th>
            <th scope="col" className="text-right">
              {col(
                "diff",
                fill(words.columns.diff.long, {
                  Difference: upperFirst(sport.difference),
                }) + (cap === null ? "" : fill(words.diffCapped, { cap })),
              )}
            </th>
            <th scope="col" className="hidden text-right md:table-cell">
              {col("streak")}
            </th>
            <th scope="col" className="hidden text-right md:table-cell">
              {col("lastFive")}
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
                        href={linkIn(
                          locale,
                          leagueHref(league, `/teams/${t.slug}`),
                        )}
                        className="inline-flex min-h-6 items-center underline"
                      >
                        {t.name}
                      </Link>
                    ) : (
                      words.team
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
                  {outcomeLetters(r.streak, locale) || "–"}
                </td>
                <td className="hidden text-right font-mono md:table-cell">
                  {outcomeLetters(r.lastFive, locale) || "–"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
