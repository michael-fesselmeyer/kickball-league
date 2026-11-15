import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GameCard } from "@/components/game-card";
import { InstagramPhotos } from "@/components/instagram-photos";
import { JsonLd } from "@/components/json-ld";
import { MemberPhotos } from "@/components/member-photos";
import { AllTimeRecord } from "@/components/history/all-time-record";
import { LogoBadge } from "@/components/logo-badge";
import { Morph, teamMorph } from "@/components/motion";
import { ShareButtons } from "@/components/share";
import { TeamStats } from "@/components/stats/team-stats";
import { db } from "@/db/client";
import {
  publicRoster,
  publishedSchedule,
  teamBySlug,
} from "@/db/queries/public-schedule";
import { approvedPhotos } from "@/db/queries/member-photos";
import { teamPhotos } from "@/db/queries/social";
import { seasonDivisionStandings } from "@/db/queries/standings";
import type { Hex } from "@/domain/color/contrast";
import { shortDay } from "@/domain/schedule/format";
import {
  hasResult,
  nextGame,
  opponentOf,
  outcomeFor,
  type PublicGame,
} from "@/domain/schedule/public-game";
import { teamShare } from "@/db/queries/team-share";
import { cardVersion } from "@/domain/share/cards";
import { teamShareText } from "@/domain/share/share-text";
import { env } from "@/env";
import { calendarLinks } from "@/lib/calendar-links";
import {
  MEMBER_PHOTOS_TAG,
  PHOTOS_TAG,
  PUBLIC_PAGE_LIFE,
  seasonTag,
  teamTag,
} from "@/lib/public-cache";
import { teamPageJsonLd } from "@/lib/seo/pages";
import { shareMetadata } from "@/lib/share/metadata";
import { absoluteUrl, siteOrigin } from "@/lib/site";
import {
  type LeagueParams,
  NO_TEAM,
  publicTeamParams,
} from "@/lib/static-params";
import type { LeagueInfo } from "@/db/queries/leagues";
import type { LeagueId } from "@/domain/ids";
import { type LeagueRef, leagueHref } from "@/domain/league/paths";
import { cachedLeague, publicLeague } from "@/lib/league/public";
import { fill } from "@/i18n/catalog";
import { formatOrdinal } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { localeOf, messagesFor } from "@/i18n/messages";
import { languageAlternates, linkIn } from "@/i18n/routing";

type Props = PageProps<"/[lang]/l/[league]/teams/[team]/[[...season]]">;

/**
 * The whole page is static, and a view the build didn't list is rendered in
 * full on its first visit instead of streaming in behind a loading state.
 * Without a <Suspense> boundary around it, the team is part of the first
 * paint: React moves a finished boundary larger than its progressive chunk
 * (12.8 kB) to the end of the document, and the browser could paint the
 * fallback first and reveal the team up to 300 ms later.
 */
export const ensureStatic = "navigation";

/**
 * Each public team's page (its current season) is prerendered at build
 * time; another season's view is rendered on its first visit and cached.
 */
export async function generateStaticParams(props: LeagueParams) {
  return (await publicTeamParams(props)).map((p) => ({ ...p, season: [] }));
}

async function cachedTeamShare(leagueId: LeagueId, slug: string) {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  cacheTag(teamTag(slug));
  return teamShare(db, leagueId, slug);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { league: segment, team: slug, lang } = await params;
  const locale = localeOf(lang);
  const words = messagesFor(locale).team;
  if (slug === NO_TEAM) return { title: words.title };
  const league = await cachedLeague(segment);
  const found = league ? await cachedTeamShare(league.id, slug) : null;
  if (!league || !found) return { title: words.title };
  const { team, card } = found;
  const description = fill(words.description, { team: team.name });
  const path = leagueHref(league, `/teams/${team.slug}`);
  return {
    title: team.name,
    description,
    alternates: {
      canonical: linkIn(locale, path),
      languages: languageAlternates(path),
    },
    ...shareMetadata({
      title: card.record ? `${team.name} · ${card.record}` : team.name,
      description,
      path: linkIn(locale, path),
      image: {
        path: `${path}/share.png?v=${cardVersion(card)}`,
        alt: card.alt,
      },
      locale,
    }),
  };
}

export default function TeamPage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-10 md:px-6">
      <Team {...props} />
    </main>
  );
}

const PLAYING = new Set(["in_progress", "playoffs"]);

/**
 * Another season arrives as `?season=<slug>`. src/proxy.ts rewrites it to
 * the optional `[[...season]]` segment, so every view depends only on the
 * route and can be served as static HTML.
 */
async function Team({ params }: Props) {
  const { league: segment, team: slug, season, lang } = await params;
  // The build's placeholder when it had no database to read.
  if (slug === NO_TEAM) notFound();
  const league = await publicLeague(segment, `/teams/${slug}`);
  return (
    <TeamView
      league={league}
      slug={slug}
      seasonSlug={season?.[0] ?? null}
      locale={localeOf(lang)}
    />
  );
}

/**
 * Cached, so after the first visit the page is served as static HTML with
 * the team in the first paint (docs/architecture.md, section 3). "Next game"
 * is worked out when the page is rendered, which happens at least once a
 * minute while people are looking at it.
 */
async function TeamView({
  league,
  slug,
  seasonSlug,
  locale,
}: {
  league: LeagueInfo;
  slug: string;
  seasonSlug: string | null;
  locale: Locale;
}) {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  const all = messagesFor(locale);
  const words = all.team;
  const href = (path: string) => linkIn(locale, leagueHref(league, path));
  cacheTag(teamTag(slug), PHOTOS_TAG, MEMBER_PHOTOS_TAG);
  const team = await teamBySlug(db, league.id, slug);
  if (!team) notFound();
  const entry =
    team.entries.find((e) => e.seasonSlug === seasonSlug) ??
    // The season being played, else the newest one.
    team.entries.find((e) => PLAYING.has(e.seasonStatus)) ??
    team.entries[0];
  if (entry) cacheTag(seasonTag(entry.seasonId));
  const links = calendarLinks(
    siteOrigin(env.BETTER_AUTH_URL),
    league,
    team.slug,
  );

  const [[games, roster, standings], photos, playerPhotos] = await Promise.all([
    entry
      ? Promise.all([
          publishedSchedule(db, entry.seasonId),
          publicRoster(db, entry.id),
          seasonDivisionStandings(db, entry.seasonId),
        ])
      : ([[], [], null] as const),
    teamPhotos(db, team.id),
    approvedPhotos(db, { teamId: team.id }),
  ]);
  const mine = entry
    ? games.filter((g) => g.teamA.id === entry.id || g.teamB.id === entry.id)
    : [];
  // Its place in its division, or in the season when there are none.
  const table = standings?.tables.find((t) =>
    t.rows.some((r) => r.teamId === entry?.id),
  );
  const row = table?.rows.find((r) => r.teamId === entry?.id);
  const division = table?.division ?? null;
  const now = new Date();
  const upNext = nextGame(mine, now);
  const results = mine.filter(hasResult);
  const open = mine.filter((g) => !hasResult(g) && g.id !== upNext?.id);
  const isOver = (g: PublicGame) => g.endsAt !== null && g.endsAt <= now;
  const toPlay = open.filter((g) => !isOver(g));
  // Played, or called off, without a final score yet.
  const awaiting = open.filter(isOver);

  const badge = (
    <LogoBadge
      kind="team"
      name={team.name}
      color={team.colorHex as Hex | null}
      size={96}
    />
  );

  return (
    <>
      <JsonLd data={teamPageJsonLd(siteOrigin(env.BETTER_AUTH_URL), team)} />
      <header className="flex flex-wrap items-center gap-4">
        {entry ? (
          <Morph name={teamMorph(entry.id)}>
            <span className="flex">{badge}</span>
          </Morph>
        ) : (
          badge
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-h1 break-words">{team.name}</h1>
          {entry && (
            <p className="text-text-muted">
              {entry.seasonName}
              {division && (
                <>
                  {" · "}
                  <Link
                    href={href(
                      `/seasons/${entry.seasonSlug}/schedule/division/${division.slug}`,
                    )}
                    className="underline"
                  >
                    {division.name}
                  </Link>
                </>
              )}
              {row && row.played > 0 && (
                <>
                  {" · "}
                  {fill(words.standing, {
                    record: `${row.wins}-${row.losses}-${row.ties}`,
                    rank: formatOrdinal(locale, row.rank),
                  })}
                </>
              )}
            </p>
          )}
          {entry?.vibe && <p className="sticker self-start">{entry.vibe}</p>}
        </div>
      </header>

      <section aria-labelledby="share" className="flex flex-col gap-2">
        <h2 id="share" className="sr-only">
          {words.share}
        </h2>
        <ShareButtons
          title={team.name}
          text={teamShareText(
            {
              name: team.name,
              seasonName: entry?.seasonName ?? null,
              record: row ?? null,
              url: absoluteUrl(
                siteOrigin(env.BETTER_AUTH_URL),
                linkIn(locale, `/teams/${team.slug}`),
              ),
            },
            locale,
          )}
          words={all.share}
        />
      </section>

      {team.entries.length > 1 && (
        <nav aria-label={words.seasons} className="flex flex-wrap gap-2">
          {team.entries.map((e) => (
            <Link
              key={e.id}
              href={href(`/teams/${team.slug}?season=${e.seasonSlug}`)}
              aria-current={e.id === entry?.id ? "page" : undefined}
              className={`btn ${e.id === entry?.id ? "btn-primary" : "btn-secondary"}`}
            >
              {e.seasonName}
            </Link>
          ))}
        </nav>
      )}

      <div className="grid gap-8 md:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-8">
          <section aria-labelledby="next" className="flex flex-col gap-3">
            <h2 id="next" className="text-h2">
              {words.next}
            </h2>
            {upNext ? (
              <GameCard
                league={league}
                game={upNext}
                timeZone={team.timeZone}
                showDay
                highlight={entry?.id}
                locale={locale}
              />
            ) : (
              <p className="text-text-muted">
                {mine.length === 0 ? words.noGames : words.wrap}
              </p>
            )}
          </section>

          {toPlay.length > 0 && (
            <section aria-labelledby="coming" className="flex flex-col gap-3">
              <h2 id="coming" className="text-h2">
                {words.coming}
              </h2>
              <ul className="flex flex-col gap-3">
                {toPlay.map((g) => (
                  <li key={g.id}>
                    <GameCard
                      league={league}
                      game={g}
                      timeZone={team.timeZone}
                      showDay
                      highlight={entry?.id}
                      locale={locale}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="results" className="flex flex-col gap-3">
            <h2 id="results" className="text-h2">
              {words.results}
            </h2>
            {results.length === 0 ? (
              <p className="text-text-muted">{words.noResults}</p>
            ) : (
              <ResultsTable
                league={league}
                games={results}
                teamId={entry?.id as string}
                timeZone={team.timeZone}
                locale={locale}
              />
            )}
            {awaiting.length > 0 && (
              <>
                <h3 className="text-h3">{words.awaiting}</h3>
                <ul className="flex flex-col gap-3">
                  {awaiting.map((g) => (
                    <li key={g.id}>
                      <GameCard
                        league={league}
                        game={g}
                        timeZone={team.timeZone}
                        showDay
                        highlight={entry?.id}
                        locale={locale}
                      />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {entry && (
            <TeamStats
              league={league}
              team={team}
              schedule={games}
              timeZone={team.timeZone}
              locale={locale}
            />
          )}

          <InstagramPhotos
            id="photos"
            heading={words.photos}
            cover={photos.cover}
            photos={photos.photos}
            opensPost={all.home.opensPost}
          />

          <MemberPhotos
            id="player-photos"
            about={team.name}
            photos={playerPhotos}
            shareHref={`/app/photos?team=${team.slug}`}
            locale={locale}
          />
        </div>

        <div className="flex flex-col gap-8">
          <section
            aria-labelledby="calendar"
            className="flex flex-col gap-3 rounded-card border-2 border-text bg-surface p-4 shadow-sticker"
          >
            <h2 id="calendar" className="text-h3">
              {words.calendarTitle}
            </h2>
            <p className="text-small text-text-muted">{words.calendarBody}</p>
            <div className="flex flex-wrap gap-2">
              <a href={links.webcal} className="btn btn-primary">
                {words.apple}
              </a>
              <a
                href={links.google}
                className="btn btn-secondary"
                target="_blank"
                rel="noopener noreferrer"
              >
                {words.google}
                <span className="sr-only">{words.newTab}</span>
              </a>
            </div>
            <label className="flex flex-col gap-1 text-small font-bold">
              {words.paste}
              <input
                readOnly
                value={links.feed}
                className="min-h-11 rounded-input border border-border-strong bg-bg px-3 font-mono text-small font-normal"
              />
            </label>
          </section>

          <AllTimeRecord league={league} team={team} locale={locale} />

          <section aria-labelledby="roster" className="flex flex-col gap-3">
            <h2 id="roster" className="text-h2">
              {words.roster}
            </h2>
            {roster.length === 0 ? (
              <p className="text-text-muted">{words.rosterEmpty}</p>
            ) : (
              <ul className="grid grid-cols-2 gap-x-4 gap-y-2">
                {roster.map((p, i) => (
                  <li
                    key={`${p.name}-${i}`}
                    className="flex flex-wrap items-center gap-2"
                  >
                    {p.name}
                    {p.role !== "player" && (
                      <span className="rounded-full border border-border-strong px-2 text-micro font-bold tracking-wide text-text-muted uppercase">
                        {p.role === "captain" ? words.captain : words.coCaptain}
                      </span>
                    )}
                    {p.awards.map((award) => (
                      <span
                        key={award}
                        className="rounded-full border border-brand px-2 text-micro font-bold tracking-wide text-brand uppercase"
                      >
                        {all.awardLabels[award]}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            )}
            {entry && roster.some((p) => p.awards.length > 0) && (
              <p>
                <Link
                  href={href(`/seasons/${entry.seasonSlug}/awards`)}
                  className="inline-flex min-h-11 items-center underline"
                >
                  {fill(words.awards, { season: entry.seasonName })}
                </Link>
              </p>
            )}
          </section>

          {entry && (
            <p>
              <Link
                href={href(
                  `/seasons/${entry.seasonSlug}/schedule?team=${team.slug}`,
                )}
                className="inline-flex min-h-11 items-center text-brand underline"
              >
                {fill(words.fullSchedule, { team: team.name })}
              </Link>
            </p>
          )}
        </div>
      </div>
    </>
  );
}

function ResultsTable({
  league,
  games,
  teamId,
  timeZone,
  locale,
}: {
  league: LeagueRef;
  games: PublicGame[];
  teamId: string;
  timeZone: string;
  locale: Locale;
}) {
  const { team: words, stats } = messagesFor(locale);
  return (
    <table className="w-full text-left tabular-nums">
      <caption className="sr-only">{words.resultsCaption}</caption>
      <thead className="text-small text-text-muted">
        <tr>
          <th scope="col" className="py-2 pr-2">
            {words.date}
          </th>
          <th scope="col">{words.opponent}</th>
          <th scope="col">{words.result}</th>
          <th scope="col" className="text-right">
            {words.score}
          </th>
        </tr>
      </thead>
      <tbody>
        {games.map((g) => {
          const outcome = outcomeFor(g, teamId) ?? "T";
          const isA = g.teamA.id === teamId;
          const score =
            g.status === "forfeit"
              ? words.forfeit
              : `${isA ? g.scoreA : g.scoreB}–${isA ? g.scoreB : g.scoreA}`;
          return (
            <tr key={g.id} className="border-t border-border">
              <td className="py-2 pr-2 text-small">
                {g.startsAt ? shortDay(g.startsAt, timeZone, locale) : "–"}
              </td>
              <td>
                <Link
                  href={linkIn(locale, leagueHref(league, `/games/${g.id}`))}
                  className="inline-flex min-h-11 items-center underline"
                >
                  {opponentOf(g, teamId).name}
                </Link>
              </td>
              <td>
                <span className={outcome === "W" ? "font-bold" : ""}>
                  <span aria-hidden="true">{stats.outcome[outcome]}</span>
                  <span className="sr-only">{words.outcome[outcome]}</span>
                </span>
              </td>
              <td className="text-right">{score}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
