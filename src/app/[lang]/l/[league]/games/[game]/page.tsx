import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { JsonLd } from "@/components/json-ld";
import { LogoBadge } from "@/components/logo-badge";
import { gameMorph, Morph, teamMorph } from "@/components/motion";
import { ForecastChip, ForecastSpace } from "@/components/forecast-chip";
import { ShareButtons } from "@/components/share";
import { LiveLine } from "@/components/line-score";
import { LiveScore } from "@/components/live-score";
import { MemberPhotos } from "@/components/member-photos";
import { GameStats } from "@/components/stats/game-stats";
import { db } from "@/db/client";
import { approvedPhotos } from "@/db/queries/member-photos";
import type { Hex } from "@/domain/color/contrast";
import { type GameId, parseId, type SeasonId } from "@/domain/ids";
import { fullWhen } from "@/domain/schedule/format";
import {
  hasResult,
  isCalledOff,
  localDay,
  outcomeFor,
  type PublicGame,
  type PublicTeam,
  resultLine,
  statusLabel,
} from "@/domain/schedule/public-game";
import { GameStatusLine, GameStatusView } from "@/components/game-day-notice";
import { cardVersion, gameCard } from "@/domain/share/cards";
import { gameShareText } from "@/domain/share/share-text";
import { env } from "@/env";
import {
  cachedDayStatus,
  cachedPageSnapshot,
  cachedPublishedGame,
} from "@/lib/game-cache";
import { MEMBER_PHOTOS_TAG, PUBLIC_PAGE_LIFE } from "@/lib/public-cache";
import { gamePageJsonLd } from "@/lib/seo/pages";
import { shareMetadata } from "@/lib/share/metadata";
import { absoluteUrl, siteOrigin } from "@/lib/site";
import type { LeagueInfo } from "@/db/queries/leagues";
import { type LeagueRef, leagueHref } from "@/domain/league/paths";
import { cachedLeague, publicLeague } from "@/lib/league/public";
import { type LeagueParams, publicGameParams } from "@/lib/static-params";
import { fill } from "@/i18n/catalog";
import type { Locale } from "@/i18n/locales";
import { localeOf, messagesFor } from "@/i18n/messages";
import { languageAlternates, linkIn } from "@/i18n/routing";

type Props = PageProps<"/[lang]/l/[league]/games/[game]">;

/**
 * The page reads its game id outside any <Suspense> boundary, so it has no
 * generic fallback shell: a game the build didn't list, or one whose page
 * was just expired, is rendered in full before it is served, then kept.
 * It can't be `ensureStatic = "navigation"`, which would also check this,
 * because the forecast and the photo prompt read the feature switches and
 * the clock per request.
 */
export const instant = false;

/**
 * Each league's games of seasons still being played are prerendered at
 * build time; any other game is rendered in full on its first visit and kept.
 */
export async function generateStaticParams(props: LeagueParams) {
  return publicGameParams(props);
}

/** Players' approved photos of the game, refreshed when one is approved. */
async function cachedGamePhotos(gameId: GameId) {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  cacheTag(MEMBER_PHOTOS_TAG);
  return approvedPhotos(db, { gameId });
}

/** The game, only if it is one of this league's (ADR 0048). */
async function load(league: LeagueInfo | null, param: string) {
  const id = parseId<GameId>(param);
  const found = league && id ? await cachedPublishedGame(id) : null;
  return found?.leagueId === league?.id ? found : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { league: segment, game: param, lang } = await params;
  const locale = localeOf(lang);
  const { game: words, stats } = messagesFor(locale);
  const league = await cachedLeague(segment);
  const found = await load(league, param);
  if (!league || !found) return { title: words.title };
  const { game } = found;
  const title = fill(stats.vs, { a: game.teamA.name, b: game.teamB.name });
  const result = resultLine(game, locale);
  const description =
    result ??
    (game.startsAt
      ? fill(words.seasonWhen, {
          season: game.seasonName,
          when: fullWhen(game.startsAt, found.timeZone, locale),
        })
      : fill(words.seasonTba, { season: game.seasonName }));
  const card = gameCard(game, found.timeZone);
  const path = leagueHref(league, `/games/${game.id}`);
  return {
    title,
    description,
    alternates: {
      canonical: linkIn(locale, path),
      languages: languageAlternates(path),
    },
    ...shareMetadata({
      title: result ?? title,
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

/**
 * The game is static HTML kept per game, with no <Suspense> boundary around
 * it, so the teams, date and place are part of the first paint (as the team
 * and season pages, ADR 0029). Behind a boundary, React moves a finished
 * segment larger than its progressive chunk to the end of the document; a
 * browser that painted the fallback first then revealed the game up to
 * 300 ms later. Only the day's status, the forecast and the photo prompt
 * stream in; the first two keep their space while they load (#495).
 */
export default function GamePage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 md:px-6">
      <Game {...props} />
    </main>
  );
}

/**
 * When the page asks for the live score: from half an hour before the start
 * until three hours after the slot ends, which covers a late start and the
 * time it takes to report the final score.
 */
function pollWindow(startsAt: Date, endsAt: Date | null) {
  const end = endsAt ?? new Date(startsAt.getTime() + 90 * 60_000);
  return {
    pollFrom: new Date(startsAt.getTime() - 30 * 60_000).toISOString(),
    pollUntil: new Date(end.getTime() + 3 * 3_600_000).toISOString(),
  };
}

/** A Google Maps link to the park: its pin when known, else its address. */
function mapLink(venue: NonNullable<PublicGame["venue"]>) {
  const query =
    venue.lat !== null && venue.lng !== null
      ? `${venue.lat},${venue.lng}`
      : [venue.name, venue.address].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

async function Game({ params }: Props) {
  const { league: segment, game: param, lang } = await params;
  const locale: Locale = localeOf(lang);
  const all = messagesFor(locale);
  const words = all.game;
  const league = await publicLeague(segment, `/games/${param}`);
  const href = (path: string) => linkIn(locale, leagueHref(league, path));
  const id = parseId<GameId>(param);
  const [found, snapshot, photos] = await Promise.all([
    load(league, param),
    id ? cachedPageSnapshot(id) : null,
    id ? cachedGamePhotos(id) : [],
  ]);
  if (!found) notFound();
  const { game, timeZone } = found;
  const done = hasResult(game);
  const calledOff = isCalledOff(game);
  const label = statusLabel(game, locale);
  const result = resultLine(game, locale);
  const matchup = fill(all.stats.vs, {
    a: game.teamA.name,
    b: game.teamB.name,
  });
  // The game day's status (issue #383) is read again per request, so it is
  // never stale; the copy kept with this page only holds its space until
  // then, so the page doesn't move when it arrives (#495).
  const statusDate =
    game.startsAt && !done && !calledOff
      ? localDay(game.startsAt, timeZone)
      : null;
  const statusWhenKept = statusDate
    ? await cachedDayStatus(game.seasonId as SeasonId, statusDate)
    : null;

  return (
    <>
      <JsonLd data={gamePageJsonLd(siteOrigin(env.BETTER_AUTH_URL), game)} />
      <nav aria-label={words.breadcrumb} className="text-small">
        <Link
          href={href(`/seasons/${game.seasonSlug}/schedule`)}
          className="inline-flex min-h-11 items-center text-brand underline"
        >
          {fill(all.schedule.seasonTitle, { season: game.seasonName })}
        </Link>
      </nav>

      <header className="flex flex-col gap-4">
        {label && (
          <p
            className={
              calledOff
                ? "self-start rounded-full border-2 border-danger px-3 py-1 text-small font-bold text-danger"
                : "sticker self-start"
            }
          >
            {label}
          </p>
        )}
        <h1 className="sr-only">
          {matchup}
          {result ? `: ${result}` : ""}
        </h1>
        <Morph name={gameMorph(game.id)}>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 rounded-card border-2 border-text bg-surface p-4 shadow-sticker md:p-8">
            <Side
              league={league}
              locale={locale}
              team={game.teamA}
              score={game.scoreA}
              show={done && game.status === "final"}
              won={outcomeFor(game, game.teamA.id) === "W"}
            />
            <p
              aria-hidden="true"
              className="font-display text-h3 text-text-muted"
            >
              {words.vs}
            </p>
            <Side
              league={league}
              locale={locale}
              team={game.teamB}
              score={game.scoreB}
              show={done && game.status === "final"}
              won={outcomeFor(game, game.teamB.id) === "W"}
            />
          </div>
        </Morph>
        {result && <p className="text-center text-body-lg">{result}</p>}
      </header>

      {snapshot && (snapshot.closed || !game.startsAt) ? (
        <LiveLine
          teamA={game.teamA.name}
          teamB={game.teamB.name}
          snapshot={snapshot}
          words={all.live}
          locale={locale}
        />
      ) : (
        game.startsAt &&
        (snapshot || (!done && !calledOff)) && (
          // Also before the first half: this copy of the page may predate it.
          <LiveScore
            gameId={game.id}
            teamA={game.teamA.name}
            teamB={game.teamB.name}
            initial={snapshot}
            {...pollWindow(game.startsAt, game.endsAt)}
            words={all.live}
            locale={locale}
          />
        )
      )}

      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1 rounded-card border border-border bg-surface p-4">
          <dt className="text-micro font-bold tracking-wide text-text-muted uppercase">
            {words.when}
          </dt>
          {/* The page's largest text, sent with the first byte: the status
              and forecast below stream in later, so they must stay smaller
              or the phone's largest paint waits for them. */}
          <dd
            className={`text-h3 font-bold ${calledOff ? "line-through" : ""}`}
          >
            {game.startsAt
              ? fullWhen(game.startsAt, timeZone, locale)
              : words.tba}
          </dd>
          {calledOff && (
            <dd className="text-small text-text-muted">{words.offNote}</dd>
          )}
          {!game.startsAt && (
            <dd className="text-small text-text-muted">
              {words.makeupWaiting}
            </dd>
          )}
          {statusDate && (
            // The game day's status (issue #383): watching, late or off.
            <Suspense
              fallback={
                <dd aria-hidden="true" className="invisible">
                  <GameStatusView
                    day={statusWhenKept}
                    gameId={game.id}
                    timeZone={timeZone}
                    locale={locale}
                  />
                </dd>
              }
            >
              <dd>
                <GameStatusLine
                  seasonId={game.seasonId as SeasonId}
                  date={statusDate}
                  gameId={game.id}
                  timeZone={timeZone}
                  locale={locale}
                />
              </dd>
            </Suspense>
          )}
          {game.status === "scheduled" &&
            !calledOff &&
            game.startsAt &&
            game.endsAt &&
            game.venue &&
            game.venue.lat !== null &&
            game.venue.lng !== null && (
              <Suspense fallback={<ForecastSpace locale={locale} />}>
                <ForecastChip
                  lat={game.venue.lat}
                  lng={game.venue.lng}
                  startsAt={game.startsAt}
                  endsAt={game.endsAt}
                  locale={locale}
                />
              </Suspense>
            )}
        </div>
        <div className="flex flex-col gap-1 rounded-card border border-border bg-surface p-4">
          <dt className="text-micro font-bold tracking-wide text-text-muted uppercase">
            {words.where}
          </dt>
          {game.venue ? (
            <>
              <dd>
                {game.field ? `${game.field}, ` : ""}
                {game.venue.name}
              </dd>
              {game.venue.address && (
                <dd className="text-small text-text-muted">
                  {game.venue.address}
                </dd>
              )}
              <dd>
                <a
                  href={mapLink(game.venue)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center text-brand underline"
                >
                  {words.openMaps}
                  <span className="sr-only">{words.newTab}</span>
                </a>
              </dd>
            </>
          ) : (
            <dd>{words.fieldTba}</dd>
          )}
        </div>
      </dl>

      <section aria-labelledby="share" className="flex flex-col gap-2">
        <h2 id="share" className="text-h3">
          {done ? words.tellChat : words.share}
        </h2>
        <ShareButtons
          title={matchup}
          text={gameShareText(game, {
            url: absoluteUrl(
              siteOrigin(env.BETTER_AUTH_URL),
              linkIn(locale, `/games/${game.id}`),
            ),
            timeZone,
            locale,
          })}
          words={all.share}
        />
      </section>

      <GameStats
        league={league}
        game={game}
        timeZone={timeZone}
        locale={locale}
      />

      {photos.length > 0 ? (
        <MemberPhotos
          id="player-photos"
          about={matchup}
          photos={photos}
          shareHref={`/app/photos?game=${game.id}`}
          locale={locale}
        />
      ) : (
        game.startsAt && (
          <Suspense fallback={null}>
            <PhotoPromptOnceStarted
              startsAt={game.startsAt}
              about={matchup}
              shareHref={`/app/photos?game=${game.id}`}
              locale={locale}
            />
          </Suspense>
        )
      )}

      <section aria-labelledby="follow" className="flex flex-col gap-2">
        <h2 id="follow" className="text-h3">
          {words.calendarTitle}
        </h2>
        <p className="text-text-muted">{words.calendarBody}</p>
        <ul className="flex flex-wrap gap-2">
          {[game.teamA, game.teamB].map((t) => (
            <li key={t.id}>
              <Link
                href={href(`/teams/${t.slug}`)}
                className="btn btn-secondary"
              >
                {fill(words.teamGames, { team: t.name })}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/**
 * The invitation to share photos, once the game has started: there's
 * nothing to photograph before. It depends on the clock, so it streams in
 * below the fold instead of making the page render per request.
 */
async function PhotoPromptOnceStarted({
  startsAt,
  about,
  shareHref,
  locale,
}: {
  startsAt: Date;
  about: string;
  shareHref: string;
  locale: Locale;
}) {
  await connection();
  if (startsAt > new Date()) return null;
  return (
    <MemberPhotos
      id="player-photos"
      about={about}
      photos={[]}
      shareHref={shareHref}
      locale={locale}
    />
  );
}

function Side({
  league,
  locale,
  team,
  score,
  show,
  won,
}: {
  league: LeagueRef;
  locale: Locale;
  team: PublicTeam;
  score: number | null;
  show: boolean;
  won: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-2 text-center">
      <Morph name={teamMorph(team.id)}>
        <span aria-hidden="true" className="flex">
          <LogoBadge
            kind="team"
            name={team.name}
            color={team.colorHex as Hex | null}
            size={64}
          />
        </span>
      </Morph>
      <Link
        href={linkIn(locale, leagueHref(league, `/teams/${team.slug}`))}
        className={`inline-flex min-h-11 items-center break-words underline ${won ? "font-bold" : ""}`}
      >
        {team.name}
      </Link>
      {show && score !== null && (
        <p
          aria-hidden="true"
          className={`font-display text-display tabular-nums ${won ? "" : "text-text-muted"}`}
        >
          {score}
        </p>
      )}
    </div>
  );
}
