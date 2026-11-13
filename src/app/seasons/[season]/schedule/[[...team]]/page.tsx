import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { GameCard } from "@/components/game-card";
import { PageLoading } from "@/components/page-loading";
import { db } from "@/db/client";
import { publishedSchedule } from "@/db/queries/public-schedule";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { dayHeading, kickoff } from "@/domain/schedule/format";
import {
  groupByDay,
  type PublicGame,
  type PublicTeam,
} from "@/domain/schedule/public-game";
import { PUBLIC_PAGE_LIFE, seasonTag } from "@/lib/public-cache";
import { NO_SEASON, publicSeasonParams } from "@/lib/static-params";

type Props = PageProps<"/seasons/[season]/schedule/[[...team]]">;

/**
 * Each public season's full schedule (no team filter) is prerendered at
 * build time; a team's view is rendered on its first visit and cached.
 */
export async function generateStaticParams() {
  return (await publicSeasonParams()).map((p) => ({ ...p, team: [] }));
}

async function cachedSeason(slug: string) {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  const season = await seasonBySlug(db, slug);
  if (season) cacheTag(seasonTag(season.id));
  return season;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { season: slug } = await params;
  if (slug === NO_SEASON) return { title: "Schedule" };
  const season = await cachedSeason(slug);
  return {
    title:
      season && season.status !== "draft"
        ? `${season.name} schedule`
        : "Schedule",
  };
}

export default function SchedulePage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10 md:px-6">
      <Suspense fallback={<PageLoading>Loading the schedule…</PageLoading>}>
        <Schedule {...props} />
      </Suspense>
    </main>
  );
}

function teamsOf(games: PublicGame[]): PublicTeam[] {
  const teams = new Map<string, PublicTeam>();
  for (const g of games) {
    teams.set(g.teamA.id, g.teamA);
    teams.set(g.teamB.id, g.teamB);
  }
  return [...teams.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The team filter arrives as `?team=<slug>`. src/proxy.ts rewrites it to the
 * optional `[[...team]]` segment, so every view depends only on the route
 * and can be served as static HTML.
 */
async function Schedule({ params }: Props) {
  const { season: slug, team } = await params;
  // The build's placeholder when it had no database to read.
  if (slug === NO_SEASON) notFound();
  return <SeasonSchedule slug={slug} teamSlug={team?.[0] ?? null} />;
}

/**
 * Cached, so after the first visit the page is served as static HTML with
 * the games in the first paint (docs/architecture.md, section 3).
 */
async function SeasonSchedule({
  slug,
  teamSlug,
}: {
  slug: string;
  teamSlug: string | null;
}) {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  const season = await seasonBySlug(db, slug);
  // Drafts are the league's work in progress, not public.
  if (!season || season.status === "draft") notFound();
  cacheTag(seasonTag(season.id));
  const all = await publishedSchedule(db, season.id);
  const teams = teamsOf(all);
  const picked = teamSlug
    ? (teams.find((t) => t.slug === teamSlug) ?? null)
    : null;
  const games = picked
    ? all.filter((g) => g.teamA.id === picked.id || g.teamB.id === picked.id)
    : all;
  const days = groupByDay(games, season.timeZone);
  const unplaced = games.filter((g) => g.startsAt === null);

  return (
    <>
      <header className="flex flex-col gap-2">
        <p className="text-text-muted">{season.name}</p>
        <h1 className="text-h1">Schedule</h1>
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
            action={`/seasons/${season.slug}/schedule`}
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
              : `Showing all ${games.length} games.`}
          </p>

          {days.map(({ day, games: dayGames }) => (
            <section
              key={day}
              aria-labelledby={`day-${day}`}
              className="flex flex-col gap-3"
            >
              <h2 id={`day-${day}`} className="text-h3">
                {dayHeading(day)}
              </h2>
              {!picked && (
                <DayGrid games={dayGames} timeZone={season.timeZone} />
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
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}

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
}: {
  games: PublicGame[];
  timeZone: string;
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
                      />
                    ) : (
                      <span className="text-small text-text-muted">Open</span>
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
