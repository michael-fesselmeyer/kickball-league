import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GameCard } from "@/components/game-card";
import { db } from "@/db/client";
import { seasonDivisions, teamDivisions } from "@/db/queries/divisions";
import { themeWeeks } from "@/db/queries/events";
import { publishedSchedule } from "@/db/queries/public-schedule";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { themeFor } from "@/domain/events/event";
import { dayHeading, kickoff } from "@/domain/schedule/format";
import {
  groupByDay,
  type PublicGame,
  type PublicTeam,
} from "@/domain/schedule/public-game";
import { ruleSetSummary } from "@/domain/season/divisions";
import {
  PUBLIC_PAGE_LIFE,
  seasonTag,
  THEME_WEEKS_TAG,
} from "@/lib/public-cache";

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
  slug,
  teamSlug = null,
  divisionSlug = null,
}: {
  slug: string;
  teamSlug?: string | null;
  divisionSlug?: string | null;
}) {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  const season = await seasonBySlug(db, slug);
  // Drafts are the league's work in progress, not public.
  if (!season || season.status === "draft") notFound();
  cacheTag(seasonTag(season.id), THEME_WEEKS_TAG);
  const [all, themes, divisions, divisionOf] = await Promise.all([
    publishedSchedule(db, season.id),
    themeWeeks(db, season.leagueId, season.timeZone),
    seasonDivisions(db, season.id),
    teamDivisions(db, season.id),
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
  const unplaced = games.filter((g) => g.startsAt === null);
  /** A game between two divisions, marked on its card. */
  const note = (g: PublicGame) => {
    const a = divisionOf.get(g.teamA.id);
    const b = divisionOf.get(g.teamB.id);
    return a && b && a !== b ? "Crossover" : undefined;
  };
  const base = `/seasons/${season.slug}/schedule`;

  return (
    <>
      <header className="flex flex-col gap-2">
        <p className="text-text-muted">{season.name}</p>
        <h1 className="text-h1">
          {division ? `${division.name} schedule` : "Schedule"}
        </h1>
        {division?.ruleSet && ruleSetSummary(division.ruleSet) && (
          <p className="text-text-muted">
            {division.ruleSet.name}: {ruleSetSummary(division.ruleSet)}
          </p>
        )}
        <nav aria-label="Season" className="flex flex-wrap gap-x-4 gap-y-1">
          <Link
            href={`/seasons/${season.slug}/standings`}
            className="inline-flex min-h-11 items-center text-brand underline"
          >
            Standings
          </Link>
          <Link
            href={`/seasons/${season.slug}/bracket`}
            className="inline-flex min-h-11 items-center text-brand underline"
          >
            Playoffs
          </Link>
        </nav>
      </header>

      {divisions.length > 0 && (
        <nav aria-label="Divisions" className="flex flex-wrap gap-2">
          <Link
            href={base}
            aria-current={division ? undefined : "page"}
            className={`btn ${division ? "btn-secondary" : "btn-primary"}`}
          >
            All divisions
          </Link>
          {divisions.map((d) => (
            <Link
              key={d.id}
              href={`${base}/division/${d.slug}`}
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
          <p className="sticker">Coming soon</p>
          <p className="max-w-prose text-body-lg">
            The schedule comes out about a week before opening day. Register now
            and we&apos;ll email you when it&apos;s up.
          </p>
        </section>
      ) : (
        <>
          <form
            method="get"
            action={base}
            className="sticky top-0 z-10 -mx-4 flex flex-wrap items-end gap-3 border-b border-border bg-bg px-4 py-3 md:mx-0 md:rounded-card md:border md:px-4"
          >
            <label className="flex flex-col gap-1 text-small font-bold">
              Team
              <select
                name="team"
                defaultValue={picked?.slug ?? ""}
                className="min-h-11 rounded-input border border-border-strong bg-surface px-3 text-body font-normal"
              >
                <option value="">All teams</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.slug}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn btn-secondary">
              Show
            </button>
            {picked && (
              <Link
                href={`/teams/${picked.slug}`}
                className="inline-flex min-h-11 items-center text-brand underline"
              >
                {picked.name} team page and calendar
              </Link>
            )}
          </form>

          <p className="sr-only" role="status">
            {picked
              ? `Showing ${games.length} games for ${picked.name}.`
              : division
                ? `Showing ${games.length} games for ${division.name}.`
                : `Showing all ${games.length} games.`}
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
                    {dayHeading(day)}
                  </h2>
                  {theme && (
                    <Link
                      href={`/events/${theme.slug}`}
                      className="sticker inline-flex min-h-11 items-center hover:underline"
                    >
                      <span className="sr-only">Theme week: </span>
                      {theme.title}
                    </Link>
                  )}
                </div>
                {!picked && (
                  <DayGrid
                    games={dayGames}
                    timeZone={season.timeZone}
                    note={note}
                    empty={division ? "–" : "Open"}
                  />
                )}
                <ul
                  className={`grid gap-3 sm:grid-cols-2 ${picked ? "" : "lg:hidden"}`}
                >
                  {dayGames.map((g) => (
                    <li key={g.id}>
                      <GameCard
                        game={g}
                        timeZone={season.timeZone}
                        highlight={picked?.id}
                        note={note(g)}
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
                Makeups to be scheduled
              </h2>
              <p className="text-text-muted">
                These games need a new date. They show up here, on the team
                pages and in calendar feeds as soon as the league sets one.
              </p>
              <ul className="grid gap-3 sm:grid-cols-2">
                {unplaced.map((g) => (
                  <li key={g.id}>
                    <GameCard
                      game={g}
                      timeZone={season.timeZone}
                      highlight={picked?.id}
                      note={note(g)}
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
  games,
  timeZone,
  note,
  empty,
}: {
  games: PublicGame[];
  timeZone: string;
  note: (g: PublicGame) => string | undefined;
  /** What an empty cell says: "Open", or a dash when other games may be there. */
  empty: string;
}) {
  const fields = [...new Set(games.map((g) => g.field ?? "Field TBA"))].sort(
    (a, b) => a.localeCompare(b, "en", { numeric: true }),
  );
  const times = [
    ...new Set(games.map((g) => (g.startsAt as Date).getTime())),
  ].sort((a, b) => a - b);
  const at = (time: number, f: string) =>
    games.find(
      (g) =>
        (g.startsAt as Date).getTime() === time &&
        (g.field ?? "Field TBA") === f,
    );
  return (
    <div className="hidden overflow-x-auto lg:block">
      <table className="w-full table-fixed border-separate border-spacing-2 text-left">
        <thead className="text-small text-text-muted">
          <tr>
            <th scope="col" className="w-24">
              Kickoff
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
                {kickoff(new Date(time), timeZone)}
              </th>
              {fields.map((f) => {
                const g = at(time, f);
                return (
                  <td key={f} className="align-top">
                    {g ? (
                      <GameCard
                        game={g}
                        timeZone={timeZone}
                        compact
                        morph={false}
                        note={note(g)}
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
