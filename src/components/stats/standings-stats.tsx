import Link from "next/link";
import { GameCard } from "@/components/game-card";
import { db } from "@/db/client";
import { publishedSchedule } from "@/db/queries/public-schedule";
import type { SeasonId } from "@/domain/ids";
import type { PublicTeam } from "@/domain/schedule/public-game";
import { pickBlurb } from "@/domain/stats/game-of-the-week";
import { movementLabel, movementWords } from "@/domain/stats/power";
import { seasonStats } from "@/domain/stats/season";
import { streakLabel } from "@/domain/stats/streaks";
import { type LeagueRef, leagueHref } from "@/domain/league/paths";
import { fill } from "@/i18n/catalog";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";
import { messagesFor } from "@/i18n/messages";
import { linkIn } from "@/i18n/routing";

type Props = {
  /** The league whose public pages the links open (ADR 0048). */
  league: LeagueRef;
  season: { id: SeasonId; timeZone: string };
  /** The season's teams, as the standings list them. */
  teams: readonly Pick<PublicTeam, "name" | "slug">[];
  /** The page's language (ADR 0094); English unless given. */
  locale?: Locale;
};

/**
 * Below the standings: the game of the week, the power rankings and a way
 * to the league records.
 */
export async function StandingsStats({
  league,
  season,
  teams,
  locale = DEFAULT_LOCALE,
}: Props) {
  const words = messagesFor(locale).stats;
  const href = (path: string) => linkIn(locale, leagueHref(league, path));
  const schedule = await publishedSchedule(db, season.id);
  const stats = seasonStats(
    schedule,
    teams.map((t) => t.slug),
    season.timeZone,
    new Date(),
  );
  const names = new Map(teams.map((t) => [t.slug, t.name]));
  const pick = stats.pick
    ? schedule.find((g) => g.id === stats.pick?.gameId)
    : undefined;

  return (
    <>
      {pick && stats.pick && (
        <section
          aria-labelledby="game-of-the-week"
          className="flex flex-col gap-3 rounded-card border-2 border-text bg-surface p-4 shadow-sticker"
        >
          <p className="sticker self-start">{words.gameOfTheWeek}</p>
          <h2 id="game-of-the-week" className="text-h3">
            {fill(words.vs, { a: pick.teamA.name, b: pick.teamB.name })}
          </h2>
          <p className="text-text-muted">
            {pickBlurb(
              stats.pick.reason,
              pick.teamA.name,
              pick.teamB.name,
              locale,
            )}
          </p>
          <GameCard
            league={league}
            game={pick}
            timeZone={season.timeZone}
            showDay
            locale={locale}
          />
        </section>
      )}

      <section aria-labelledby="power" className="flex flex-col gap-3">
        <h2 id="power" className="text-h2">
          {words.powerTitle}
        </h2>
        {stats.power.length === 0 ? (
          <p className="text-text-muted">{words.powerEmpty}</p>
        ) : (
          <>
            <p className="text-small text-text-muted">{words.powerIntro}</p>
            <ol className="flex flex-col">
              {stats.power.map((r) => (
                <li
                  key={r.team}
                  className="flex min-h-11 items-center gap-3 border-t border-border py-2"
                >
                  <span className="w-8 shrink-0 font-display text-h3 tabular-nums">
                    {r.rank}
                  </span>
                  <Link
                    href={href(`/teams/${r.team}`)}
                    className="inline-flex min-h-11 min-w-0 flex-1 items-center break-words underline"
                  >
                    {names.get(r.team) ?? r.team}
                  </Link>
                  <span className="hidden text-small text-text-muted tabular-nums sm:inline">
                    {streakLabel(
                      stats.streaks.get(r.team)?.current ?? null,
                      locale,
                    )}
                  </span>
                  <span className="w-12 shrink-0 text-right text-small font-bold tabular-nums">
                    <span aria-hidden="true">
                      {movementLabel(r.movement, locale)}
                    </span>
                    <span className="sr-only">
                      {movementWords(r.movement, locale)}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>

      <p>
        <Link
          href={href("/records")}
          className="inline-flex min-h-11 items-center text-brand underline"
        >
          {words.records}
        </Link>
      </p>
    </>
  );
}
