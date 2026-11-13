import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LogoBadge } from "@/components/logo-badge";
import { Arrive } from "@/components/arrive";
import { gameMorph, Morph, teamMorph } from "@/components/motion";
import { ForecastChip } from "@/components/forecast-chip";
import { ShareButtons } from "@/components/share";
import { LiveLine } from "@/components/line-score";
import { LiveScore } from "@/components/live-score";
import { MemberPhotos } from "@/components/member-photos";
import { GameStats } from "@/components/stats/game-stats";
import { PageLoading } from "@/components/page-loading";
import { db } from "@/db/client";
import { liveGame, snapshotOf } from "@/db/queries/live-scores";
import { approvedPhotos } from "@/db/queries/member-photos";
import { publishedGame } from "@/db/queries/public-schedule";
import type { Hex } from "@/domain/color/contrast";
import { type GameId, parseId } from "@/domain/ids";
import { fullWhen } from "@/domain/schedule/format";
import {
  hasResult,
  isCalledOff,
  outcomeFor,
  type PublicGame,
  type PublicTeam,
  resultLine,
  statusLabel,
} from "@/domain/schedule/public-game";
import { cardVersion, gameCard } from "@/domain/share/cards";
import { gameShareText } from "@/domain/share/share-text";
import { env } from "@/env";
import { MEMBER_PHOTOS_TAG, PUBLIC_PAGE_LIFE } from "@/lib/public-cache";
import { shareMetadata } from "@/lib/share/metadata";
import { absoluteUrl, siteOrigin } from "@/lib/site";

/** Players' approved photos of the game, refreshed when one is approved. */
async function cachedGamePhotos(gameId: GameId) {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  cacheTag(MEMBER_PHOTOS_TAG);
  return approvedPhotos(db, { gameId });
}

async function load(param: string) {
  const id = parseId<GameId>(param);
  return id ? publishedGame(db, id) : null;
}

export async function generateMetadata({
  params,
}: PageProps<"/games/[game]">): Promise<Metadata> {
  const found = await load((await params).game);
  if (!found) return { title: "Game" };
  const { game } = found;
  const title = `${game.teamA.name} vs ${game.teamB.name}`;
  const description =
    resultLine(game) ??
    (game.startsAt
      ? `${game.seasonName}: ${fullWhen(game.startsAt, found.timeZone)}`
      : `${game.seasonName}: time to be announced`);
  const card = gameCard(game, found.timeZone);
  const path = `/games/${game.id}`;
  return {
    title,
    description,
    ...shareMetadata({
      title: resultLine(game) ?? title,
      description,
      path,
      image: {
        path: `${path}/share.png?v=${cardVersion(card)}`,
        alt: card.alt,
      },
    }),
  };
}

export default function GamePage(props: PageProps<"/games/[game]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 md:px-6">
      <Suspense fallback={<PageLoading>Loading the game…</PageLoading>}>
        <Arrive>
          <Game {...props} />
        </Arrive>
      </Suspense>
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

async function Game({ params }: PageProps<"/games/[game]">) {
  const param = (await params).game;
  const id = parseId<GameId>(param);
  const [found, live, photos] = await Promise.all([
    load(param),
    id ? liveGame(db, id) : null,
    id ? cachedGamePhotos(id) : [],
  ]);
  if (!found) notFound();
  const { game, timeZone } = found;
  const snapshot = live ? snapshotOf(live) : null;
  const done = hasResult(game);
  const calledOff = isCalledOff(game);
  const label = statusLabel(game);
  const result = resultLine(game);

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-small">
        <Link
          href={`/seasons/${game.seasonSlug}/schedule`}
          className="inline-flex min-h-11 items-center text-brand underline"
        >
          {game.seasonName} schedule
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
          {game.teamA.name} vs {game.teamB.name}
          {result ? `: ${result}` : ""}
        </h1>
        <Morph name={gameMorph(game.id)}>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 rounded-card border-2 border-text bg-surface p-4 shadow-sticker md:p-8">
            <Side
              team={game.teamA}
              score={game.scoreA}
              show={done && game.status === "final"}
              won={outcomeFor(game, game.teamA.id) === "W"}
            />
            <p
              aria-hidden="true"
              className="font-display text-h3 text-text-muted"
            >
              vs
            </p>
            <Side
              team={game.teamB}
              score={game.scoreB}
              show={done && game.status === "final"}
              won={outcomeFor(game, game.teamB.id) === "W"}
            />
          </div>
        </Morph>
        {result && <p className="text-center text-body-lg">{result}</p>}
      </header>

      {snapshot &&
        (snapshot.closed || !game.startsAt ? (
          <LiveLine
            teamA={game.teamA.name}
            teamB={game.teamB.name}
            snapshot={snapshot}
          />
        ) : (
          <LiveScore
            gameId={game.id}
            teamA={game.teamA.name}
            teamB={game.teamB.name}
            initial={snapshot}
            {...pollWindow(game.startsAt, game.endsAt)}
          />
        ))}

      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1 rounded-card border border-border bg-surface p-4">
          <dt className="text-micro font-bold tracking-wide text-text-muted uppercase">
            When
          </dt>
          <dd className={calledOff ? "line-through" : ""}>
            {game.startsAt
              ? fullWhen(game.startsAt, timeZone)
              : "Time to be announced"}
          </dd>
          {calledOff && (
            <dd className="text-small text-text-muted">
              This game is off. The league posts a makeup date here and in the
              calendar feeds once it is set.
            </dd>
          )}
          {!game.startsAt && (
            <dd className="text-small text-text-muted">
              This makeup is waiting for an open slot.
            </dd>
          )}
          {game.status === "scheduled" &&
            !calledOff &&
            game.startsAt &&
            game.endsAt &&
            game.venue &&
            game.venue.lat !== null &&
            game.venue.lng !== null && (
              <Suspense fallback={null}>
                <ForecastChip
                  lat={game.venue.lat}
                  lng={game.venue.lng}
                  startsAt={game.startsAt}
                  endsAt={game.endsAt}
                />
              </Suspense>
            )}
        </div>
        <div className="flex flex-col gap-1 rounded-card border border-border bg-surface p-4">
          <dt className="text-micro font-bold tracking-wide text-text-muted uppercase">
            Where
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
                  Open in Maps
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </dd>
            </>
          ) : (
            <dd>Field to be announced</dd>
          )}
        </div>
      </dl>

      <section aria-labelledby="share" className="flex flex-col gap-2">
        <h2 id="share" className="text-h3">
          {done ? "Tell the group chat" : "Share this game"}
        </h2>
        <ShareButtons
          title={`${game.teamA.name} vs ${game.teamB.name}`}
          text={gameShareText(game, {
            url: absoluteUrl(
              siteOrigin(env.BETTER_AUTH_URL),
              `/games/${game.id}`,
            ),
            timeZone,
          })}
        />
      </section>

      <GameStats game={game} timeZone={timeZone} />

      {/* Once it has started: there's nothing to photograph before. */}
      {(photos.length > 0 ||
        (game.startsAt !== null && game.startsAt <= new Date())) && (
        <MemberPhotos
          id="player-photos"
          about={`${game.teamA.name} vs ${game.teamB.name}`}
          photos={photos}
          shareHref={`/app/photos?game=${game.id}`}
        />
      )}

      <section aria-labelledby="follow" className="flex flex-col gap-2">
        <h2 id="follow" className="text-h3">
          Add it to your calendar
        </h2>
        <p className="text-text-muted">
          Each team page has a calendar feed with every game, kept up to date.
        </p>
        <ul className="flex flex-wrap gap-2">
          {[game.teamA, game.teamB].map((t) => (
            <li key={t.id}>
              <Link href={`/teams/${t.slug}`} className="btn btn-secondary">
                {t.name} games
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function Side({
  team,
  score,
  show,
  won,
}: {
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
        href={`/teams/${team.slug}`}
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
