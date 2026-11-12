import Link from "next/link";
import { db } from "@/db/client";
import {
  publishedGamesBetween,
  publishedSchedule,
} from "@/db/queries/public-schedule";
import type { SeasonId } from "@/domain/ids";
import { shortDay } from "@/domain/schedule/format";
import type { PublicGame } from "@/domain/schedule/public-game";
import { pickBlurb } from "@/domain/stats/game-of-the-week";
import { rivalry, seriesLine } from "@/domain/stats/rivalry";
import { seasonStats, statGamesFrom, teamsFrom } from "@/domain/stats/season";
import { streakLabel } from "@/domain/stats/streaks";

const MEETINGS_SHOWN = 5;

/** The head-to-head history, and the game of the week callout when it is. */
export async function GameStats({
  game,
  timeZone,
}: {
  game: PublicGame;
  timeZone: string;
}) {
  const [between, schedule] = await Promise.all([
    publishedGamesBetween(db, game.teamA.slug, game.teamB.slug),
    publishedSchedule(db, game.seasonId as SeasonId),
  ]);
  const a = game.teamA.slug;
  const b = game.teamB.slug;
  const stats = seasonStats(
    schedule,
    [...teamsFrom(schedule).keys()],
    timeZone,
    new Date(),
  );
  const series = rivalry(a, b, statGamesFrom(between));
  const name = (slug: string) =>
    slug === a ? game.teamA.name : game.teamB.name;
  const isPick = stats.pick?.gameId === game.id;
  const form = [game.teamA, game.teamB].map((t) => ({
    team: t,
    streak: streakLabel(stats.streaks.get(t.slug)?.current ?? null),
  }));

  return (
    <>
      {isPick && stats.pick && (
        <section
          aria-labelledby="pick"
          className="flex flex-col gap-2 rounded-card border-2 border-text bg-surface p-4 shadow-sticker"
        >
          <h2 id="pick" className="sticker self-start">
            Game of the week
          </h2>
          <p>
            {pickBlurb(stats.pick.reason, game.teamA.name, game.teamB.name)}
          </p>
        </section>
      )}

      <section aria-labelledby="head-to-head" className="flex flex-col gap-3">
        <h2 id="head-to-head" className="text-h3">
          Head to head
        </h2>
        <p className="text-body-lg">{seriesLine(series, name)}</p>
        {form.some((f) => f.streak) && (
          <p className="text-small text-text-muted">
            This season&apos;s streaks:{" "}
            {form
              .map((f) => `${f.team.name} ${f.streak || "none yet"}`)
              .join(", ")}
            .
          </p>
        )}
        {series.history.length > 0 && (
          <ul className="flex flex-col">
            {series.history.slice(0, MEETINGS_SHOWN).map((m) => (
              <li
                key={m.gameId}
                className="flex flex-wrap items-center justify-between gap-x-3 border-t border-border py-1"
              >
                <Link
                  href={`/games/${m.gameId}`}
                  aria-current={m.gameId === game.id ? "page" : undefined}
                  className="inline-flex min-h-11 items-center underline"
                >
                  {shortDay(m.playedAt, timeZone)}
                </Link>
                <span className="text-small tabular-nums">
                  {m.winner === null
                    ? `Tied ${m.runsX}–${m.runsY}`
                    : m.runsX === null || m.runsY === null
                      ? `${name(m.winner)} by forfeit`
                      : `${name(m.winner)} ${Math.max(m.runsX, m.runsY)}–${Math.min(m.runsX, m.runsY)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
