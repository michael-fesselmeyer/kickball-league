import { cacheLife } from "next/cache";
import Link from "next/link";
import type { SeasonId } from "@/domain/ids";
import { shortDay } from "@/domain/schedule/format";
import type { PublicGame } from "@/domain/schedule/public-game";
import { pickBlurb } from "@/domain/stats/game-of-the-week";
import { rivalry, seriesLine } from "@/domain/stats/rivalry";
import { seasonStats, statGamesFrom, teamsFrom } from "@/domain/stats/season";
import { streakLabel } from "@/domain/stats/streaks";
import { cachedMeetings, cachedSeasonSchedule } from "@/lib/game-cache";
import { PUBLIC_PAGE_LIFE } from "@/lib/public-cache";
import { type LeagueRef, leagueHref } from "@/domain/league/paths";
import type { LeagueId } from "@/domain/ids";
import { fill } from "@/i18n/catalog";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";
import { messagesFor } from "@/i18n/messages";
import { linkIn } from "@/i18n/routing";

const MEETINGS_SHOWN = 5;

/**
 * The head-to-head history, and the game of the week callout when it is.
 * Cached like the reads it makes, and carrying their season and team tags,
 * so the game page stays static: the next game day is worked out from the
 * clock when the copy is made, as on the team page.
 */
export async function GameStats({
  league,
  game,
  timeZone,
  locale = DEFAULT_LOCALE,
}: {
  league: LeagueRef & { id: LeagueId };
  game: PublicGame;
  timeZone: string;
  /** The page's language (ADR 0094); English unless given. */
  locale?: Locale;
}) {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  const [between, schedule] = await Promise.all([
    cachedMeetings(league.id, game.teamA.slug, game.teamB.slug),
    cachedSeasonSchedule(game.seasonId as SeasonId),
  ]);
  const words = messagesFor(locale).stats;
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
    streak: streakLabel(stats.streaks.get(t.slug)?.current ?? null, locale),
  }));

  return (
    <>
      {isPick && stats.pick && (
        <section
          aria-labelledby="pick"
          className="flex flex-col gap-2 rounded-card border-2 border-text bg-surface p-4 shadow-sticker"
        >
          <h2 id="pick" className="sticker self-start">
            {words.gameOfTheWeek}
          </h2>
          <p>
            {pickBlurb(
              stats.pick.reason,
              game.teamA.name,
              game.teamB.name,
              locale,
            )}
          </p>
        </section>
      )}

      <section aria-labelledby="head-to-head" className="flex flex-col gap-3">
        <h2 id="head-to-head" className="text-h3">
          {words.headToHead}
        </h2>
        <p className="text-body-lg">{seriesLine(series, name, locale)}</p>
        {form.some((f) => f.streak) && (
          <p className="text-small text-text-muted">
            {fill(words.seasonStreaks, {
              list: form
                .map((f) =>
                  fill(words.teamStreak, {
                    team: f.team.name,
                    streak: f.streak || words.noneYet,
                  }),
                )
                .join(", "),
            })}
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
                  href={linkIn(
                    locale,
                    leagueHref(league, `/games/${m.gameId}`),
                  )}
                  aria-current={m.gameId === game.id ? "page" : undefined}
                  className="inline-flex min-h-11 items-center underline"
                >
                  {shortDay(m.playedAt, timeZone, locale)}
                </Link>
                <span className="text-small tabular-nums">
                  {m.winner === null
                    ? fill(words.tiedScore, { score: `${m.runsX}–${m.runsY}` })
                    : m.runsX === null || m.runsY === null
                      ? fill(words.byForfeit, { team: name(m.winner) })
                      : fill(words.wonScore, {
                          team: name(m.winner),
                          score: `${Math.max(m.runsX, m.runsY)}–${Math.min(m.runsX, m.runsY)}`,
                        })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
