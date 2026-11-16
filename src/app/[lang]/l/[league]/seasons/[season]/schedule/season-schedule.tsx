import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GameCard } from "@/components/game-card";
import { GameDayNotice, toneOf } from "@/components/game-day-notice";
import { db } from "@/db/client";
import { seasonDivisions, teamDivisions } from "@/db/queries/divisions";
import { themeWeeks } from "@/db/queries/events";
import { statusesFrom } from "@/db/queries/game-day-status";
import { publishedSchedule } from "@/db/queries/public-schedule";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { themeFor } from "@/domain/events/event";
import { dayLine, gameStatus, gameWords } from "@/domain/gameday/status";
import { dayHeading, kickoff, shortDay } from "@/domain/schedule/format";
import {
  groupByDay,
  localDay,
  type PublicGame,
  type PublicTeam,
} from "@/domain/schedule/public-game";
import { ruleSetSummary } from "@/domain/season/divisions";
import {
  PUBLIC_PAGE_LIFE,
  seasonTag,
  THEME_WEEKS_TAG,
} from "@/lib/public-cache";
import type { LeagueInfo } from "@/db/queries/leagues";
import { type LeagueRef, leagueHref } from "@/domain/league/paths";
import { isPublicSeason } from "@/domain/private-events/visibility";
import { fill, plural } from "@/i18n/catalog";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";
import { messagesFor } from "@/i18n/messages";
import { linkIn } from "@/i18n/routing";

function teamsOf(games: PublicGame[]): PublicTeam[] {
  const teams = new Map<string, PublicTeam>();
  for (const g of games) {
    teams.set(g.teamA.id, g.teamA);
    teams.set(g.teamB.id, g.teamB);
  }
  return [...teams.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A season's public schedule: every game, one team's (the `[[...team]]`
 * route) or one division's with its crossovers (`division/[division]`,
 * ADR 0040). Each view is picked by the path, never the query string, so
 * each is served as static HTML with the games in the first paint
 * (docs/architecture.md, section 3).
 */
export async function SeasonSchedule({
  league,
  slug,
  teamSlug = null,
  divisionSlug = null,
  locale = DEFAULT_LOCALE,
}: {
  league: LeagueInfo;
  slug: string;
  teamSlug?: string | null;
  divisionSlug?: string | null;
  /** The page's language: each one is cached on its own (ADR 0094). */
  locale?: Locale;
}) {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  const season = await seasonBySlug(db, league.id, slug);
  // Drafts are the league's work in progress, not public.
  if (!season || !isPublicSeason(season)) notFound();
  cacheTag(seasonTag(season.id), THEME_WEEKS_TAG);
  // Setting a game day's status expires the season tag (issue #383).
  const today = localDay(new Date(), season.timeZone);
  const [all, themes, divisions, divisionOf, statuses] = await Promise.all([
    publishedSchedule(db, season.id),
    themeWeeks(db, season.leagueId, season.timeZone),
    seasonDivisions(db, season.id),
    teamDivisions(db, season.id),
    statusesFrom(db, season.id, today),
  ]);
  const division = divisionSlug
    ? divisions.find((d) => d.slug === divisionSlug)
    : null;
  if (division === undefined) notFound();
  const inView = division
    ? all.filter(
        (g) =>
          divisionOf.get(g.teamA.id) === division.id ||
          divisionOf.get(g.teamB.id) === division.id,
      )
    : all;
  const teams = teamsOf(inView);
  const picked = teamSlug
    ? (teams.find((t) => t.slug === teamSlug) ?? null)
    : null;
  const games = picked
    ? inView.filter((g) => g.teamA.id === picked.id || g.teamB.id === picked.id)
    : inView;
  const days = groupByDay(games, season.timeZone);
  const words = messagesFor(locale).schedule;
  const href = (path: string) => linkIn(locale, leagueHref(league, path));
  const unplaced = games.filter((g) => g.startsAt === null);
  /**
   * A game that starts late or is off says so on its card; otherwise a game
   * between two divisions is marked.
   */
  const note = (g: PublicGame) => {
    const day = g.startsAt ? localDay(g.startsAt, season.timeZone) : null;
    const status = day ? gameStatus(statuses.get(day) ?? null, g.id) : null;
    if (status && (status.kind === "delayed" || status.kind === "off"))
      return gameWords(status, season.timeZone, locale) ?? undefined;
    const a = divisionOf.get(g.teamA.id);
    const b = divisionOf.get(g.teamB.id);
    return a && b && a !== b ? words.crossover : undefined;
  };
  /** The day lines at the top: today's and later days' statuses. */
  const banners = [...statuses.values()].flatMap((s) => {
    const dayCount = all.filter(
      (g) => g.startsAt && localDay(g.startsAt, season.timeZone) === s.date,
    ).length;
    const line = dayLine(s, dayCount, season.timeZone, locale);
    return line && dayCount > 0 ? [{ status: s, line }] : [];
  });
  const base = `/seasons/${season.slug}/schedule`;

  return (
    <>
      <header className="flex flex-col gap-2">
        <p className="text-text-muted">{season.name}</p>
        <h1 className="text-h1">
          {division
            ? fill(words.divisionTitle, { division: division.name })
            : words.title}
        </h1>
        {division?.ruleSet && ruleSetSummary(division.ruleSet, locale) && (
          <p className="text-text-muted">
            {division.ruleSet.name}: {ruleSetSummary(division.ruleSet, locale)}
          </p>
        )}
        <nav
          aria-label={words.seasonNav}
          className="flex flex-wrap gap-x-4 gap-y-1"
        >
          <Link
            href={href(`/seasons/${season.slug}/standings`)}
            className="inline-flex min-h-11 items-center text-brand underline"
          >
            {words.standings}
          </Link>
          <Link
            href={href(`/seasons/${season.slug}/bracket`)}
            className="inline-flex min-h-11 items-center text-brand underline"
          >
            {words.playoffs}
          </Link>
        </nav>
      </header>

      {banners.length > 0 && (
        <section aria-label={words.statusLabel} className="flex flex-col gap-2">
          {banners.map(({ status, line }) => (
            <GameDayNotice
              key={status.date}
              label={shortDay(
                new Date(`${status.date}T12:00:00Z`),
                "UTC",
                locale,
              )}
              line={line}
              setAt={status.setAt}
              timeZone={season.timeZone}
              tone={toneOf(status.state)}
              locale={locale}
            />
          ))}
        </section>
      )}

      {divisions.length > 0 && (
        <nav aria-label={words.divisionsNav} className="flex flex-wrap gap-2">
          <Link
            href={href(base)}
            aria-current={division ? undefined : "page"}
            className={`btn ${division ? "btn-secondary" : "btn-primary"}`}
          >
            {words.allDivisions}
          </Link>
          {divisions.map((d) => (
            <Link
              key={d.id}
              href={href(`${base}/division/${d.slug}`)}
              aria-current={d.id === division?.id ? "page" : undefined}
              className={`btn ${d.id === division?.id ? "btn-primary" : "btn-secondary"}`}
            >
              {d.name}
            </Link>
          ))}
        </nav>
      )}

      {all.length === 0 ? (
        <section className="flex flex-col items-start gap-3 rounded-card border border-border bg-surface p-6">
          <p className="sticker">{words.comingSoon}</p>
          <p className="max-w-prose text-body-lg">{words.comingSoonBody}</p>
        </section>
      ) : (
        <>
          <form
            method="get"
            action={href(base)}
            className="sticky top-0 z-10 -mx-4 flex flex-wrap items-end gap-3 border-b border-border bg-bg px-4 py-3 md:mx-0 md:rounded-card md:border md:px-4"
          >
            <label className="flex flex-col gap-1 text-small font-bold">
              {words.team}
              <select
                name="team"
                defaultValue={picked?.slug ?? ""}
                className="min-h-11 rounded-input border border-border-strong bg-surface px-3 text-body font-normal"
              >
                <option value="">{words.allTeams}</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.slug}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn btn-secondary">
              {words.show}
            </button>
            {picked && (
              <Link
                href={href(`/teams/${picked.slug}`)}
                className="inline-flex min-h-11 items-center text-brand underline"
              >
                {fill(words.teamPage, { team: picked.name })}
              </Link>
            )}
          </form>

          <p className="sr-only" role="status">
            {picked || division
              ? plural(locale, words.showingTeam, games.length, {
                  name: (picked ?? division)?.name ?? "",
                })
              : plural(locale, words.showingAll, games.length)}
          </p>

          {days.map(({ day, games: dayGames }) => {
            const theme = themeFor(day, themes);
            return (
              <section
                key={day}
                aria-labelledby={`day-${day}`}
                className="flex flex-col gap-3"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <h2 id={`day-${day}`} className="text-h3">
                    {dayHeading(day, locale)}
                  </h2>
                  {theme && (
                    <Link
                      href={href(`/events/${theme.slug}`)}
                      className="sticker inline-flex min-h-11 items-center hover:underline"
                    >
                      <span className="sr-only">{words.themeWeek} </span>
                      {theme.title}
                    </Link>
                  )}
                </div>
                {!picked && (
                  <DayGrid
                    league={league}
                    games={dayGames}
                    timeZone={season.timeZone}
                    note={note}
                    empty={division ? "–" : words.open}
                    locale={locale}
                  />
                )}
                <ul
                  className={`grid gap-3 sm:grid-cols-2 ${picked ? "" : "lg:hidden"}`}
                >
                  {dayGames.map((g) => (
                    <li key={g.id}>
                      <GameCard
                        league={league}
                        game={g}
                        timeZone={season.timeZone}
                        highlight={picked?.id}
                        note={note(g)}
                        locale={locale}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          {unplaced.length > 0 && (
            <section aria-labelledby="unplaced" className="flex flex-col gap-3">
              <h2 id="unplaced" className="text-h3">
                {words.makeups}
              </h2>
              <p className="text-text-muted">{words.makeupsBody}</p>
              <ul className="grid gap-3 sm:grid-cols-2">
                {unplaced.map((g) => (
                  <li key={g.id}>
                    <GameCard
                      league={league}
                      game={g}
                      timeZone={season.timeZone}
                      highlight={picked?.id}
                      note={note(g)}
                      locale={locale}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}

/**
 * The desktop view of one date: fields across, kickoff times down, so a
 * player can see the whole night at a glance. Phones get the list instead.
 */
function DayGrid({
  league,
  games,
  timeZone,
  note,
  empty,
  locale,
}: {
  league: LeagueRef;
  games: PublicGame[];
  timeZone: string;
  note: (g: PublicGame) => string | undefined;
  /** What an empty cell says: "Open", or a dash when other games may be there. */
  empty: string;
  locale: Locale;
}) {
  const words = messagesFor(locale).schedule;
  const fields = [...new Set(games.map((g) => g.field ?? words.fieldTba))].sort(
    (a, b) => a.localeCompare(b, locale, { numeric: true }),
  );
  const times = [
    ...new Set(games.map((g) => (g.startsAt as Date).getTime())),
  ].sort((a, b) => a - b);
  const at = (time: number, f: string) =>
    games.find(
      (g) =>
        (g.startsAt as Date).getTime() === time &&
        (g.field ?? words.fieldTba) === f,
    );
  return (
    <div className="hidden overflow-x-auto lg:block">
      <table className="w-full table-fixed border-separate border-spacing-2 text-left">
        <thead className="text-small text-text-muted">
          <tr>
            <th scope="col" className="w-24">
              {words.kickoff}
            </th>
            {fields.map((f) => (
              <th key={f} scope="col">
                {f}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {times.map((time) => (
            <tr key={time}>
              <th scope="row" className="align-top font-bold tabular-nums">
                {kickoff(new Date(time), timeZone, locale)}
              </th>
              {fields.map((f) => {
                const g = at(time, f);
                return (
                  <td key={f} className="align-top">
                    {g ? (
                      <GameCard
                        league={league}
                        game={g}
                        timeZone={timeZone}
                        compact
                        morph={false}
                        note={note(g)}
                        locale={locale}
                      />
                    ) : (
                      <span className="text-small text-text-muted">
                        {empty}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
