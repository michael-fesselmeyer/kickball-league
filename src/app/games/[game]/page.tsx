import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LogoBadge } from "@/components/logo-badge";
import { ShareButtons } from "@/components/share";
import { GameStats } from "@/components/stats/game-stats";
import { db } from "@/db/client";
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
import { shareMetadata } from "@/lib/share/metadata";
import { absoluteUrl, siteOrigin } from "@/lib/site";

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
      <Suspense fallback={<p>Loading the game…</p>}>
        <Game {...props} />
      </Suspense>
    </main>
  );
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
  const found = await load((await params).game);
  if (!found) notFound();
  const { game, timeZone } = found;
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
        {result && <p className="text-center text-body-lg">{result}</p>}
      </header>

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
      <span aria-hidden="true" className="flex">
        <LogoBadge
          kind="team"
          name={team.name}
          color={team.colorHex as Hex | null}
          size={64}
        />
      </span>
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
