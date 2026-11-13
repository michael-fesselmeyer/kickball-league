import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GameCard } from "@/components/game-card";
import { InstagramPhotos } from "@/components/instagram-photos";
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
import { shareMetadata } from "@/lib/share/metadata";
import { absoluteUrl, siteOrigin } from "@/lib/site";
import { NO_TEAM, publicTeamParams } from "@/lib/static-params";

type Props = PageProps<"/teams/[team]/[[...season]]">;

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
export async function generateStaticParams() {
  return (await publicTeamParams()).map((p) => ({ ...p, season: [] }));
}

async function cachedTeamShare(slug: string) {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  cacheTag(teamTag(slug));
  return teamShare(db, slug);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { team: slug } = await params;
  if (slug === NO_TEAM) return { title: "Team" };
  const found = await cachedTeamShare(slug);
  if (!found) return { title: "Team" };
  const { team, card } = found;
  const description = `${team.name}: schedule, results, roster and a calendar feed.`;
  const path = `/teams/${team.slug}`;
  return {
    title: team.name,
    description,
    ...shareMetadata({
      title: card.record ? `${team.name} · ${card.record}` : team.name,
      description,
      path,
      image: {
        path: `${path}/share.png?v=${cardVersion(card)}`,
        alt: card.alt,
      },
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

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

const PLAYING = new Set(["in_progress", "playoffs"]);

/**
 * Another season arrives as `?season=<slug>`. src/proxy.ts rewrites it to
 * the optional `[[...season]]` segment, so every view depends only on the
 * route and can be served as static HTML.
 */
async function Team({ params }: Props) {
  const { team: slug, season } = await params;
  // The build's placeholder when it had no database to read.
  if (slug === NO_TEAM) notFound();
  return <TeamView slug={slug} seasonSlug={season?.[0] ?? null} />;
}

/**
 * Cached, so after the first visit the page is served as static HTML with
 * the team in the first paint (docs/architecture.md, section 3). "Next game"
 * is worked out when the page is rendered, which happens at least once a
 * minute while people are looking at it.
 */
async function TeamView({
  slug,
  seasonSlug,
}: {
  slug: string;
  seasonSlug: string | null;
}) {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  cacheTag(teamTag(slug), PHOTOS_TAG, MEMBER_PHOTOS_TAG);
  const team = await teamBySlug(db, slug);
  if (!team) notFound();
  const entry =
    team.entries.find((e) => e.seasonSlug === seasonSlug) ??
    // The season being played, else the newest one.
    team.entries.find((e) => PLAYING.has(e.seasonStatus)) ??
    team.entries[0];
  if (entry) cacheTag(seasonTag(entry.seasonId));
  const links = calendarLinks(siteOrigin(env.BETTER_AUTH_URL), team.slug);

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
                    href={`/seasons/${entry.seasonSlug}/schedule/division/${division.slug}`}
                    className="underline"
                  >
                    {division.name}
                  </Link>
                </>
              )}
              {row && row.played > 0 && (
                <>
                  {" "}
                  · {row.wins}-{row.losses}-{row.ties}, {ordinal(row.rank)}{" "}
                  place
                </>
              )}
            </p>
          )}
          {entry?.vibe && <p className="sticker self-start">{entry.vibe}</p>}
        </div>
      </header>

      <section aria-labelledby="share" className="flex flex-col gap-2">
        <h2 id="share" className="sr-only">
          Share this team
        </h2>
        <ShareButtons
          title={team.name}
          text={teamShareText({
            name: team.name,
            seasonName: entry?.seasonName ?? null,
            record: row ?? null,
            url: absoluteUrl(
              siteOrigin(env.BETTER_AUTH_URL),
              `/teams/${team.slug}`,
            ),
          })}
        />
      </section>

      {team.entries.length > 1 && (
        <nav aria-label="Seasons" className="flex flex-wrap gap-2">
          {team.entries.map((e) => (
            <Link
              key={e.id}
              href={`/teams/${team.slug}?season=${e.seasonSlug}`}
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
              Next game
            </h2>
            {upNext ? (
              <GameCard
                game={upNext}
                timeZone={team.timeZone}
                showDay
                highlight={entry?.id}
              />
            ) : (
              <p className="text-text-muted">
                {mine.length === 0
                  ? "No games on the schedule yet. It comes out about a week before opening day."
                  : "That's a wrap: no games left this season. Thanks for playing!"}
              </p>
            )}
          </section>

          {toPlay.length > 0 && (
            <section aria-labelledby="coming" className="flex flex-col gap-3">
              <h2 id="coming" className="text-h2">
                Coming up
              </h2>
              <ul className="flex flex-col gap-3">
                {toPlay.map((g) => (
                  <li key={g.id}>
                    <GameCard
                      game={g}
                      timeZone={team.timeZone}
                      showDay
                      highlight={entry?.id}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="results" className="flex flex-col gap-3">
            <h2 id="results" className="text-h2">
              Results
            </h2>
            {results.length === 0 ? (
              <p className="text-text-muted">
                No results yet. First pitch is the hardest.
              </p>
            ) : (
              <ResultsTable
                games={results}
                teamId={entry?.id as string}
                timeZone={team.timeZone}
              />
            )}
            {awaiting.length > 0 && (
              <>
                <h3 className="text-h3">Scores still to come</h3>
                <ul className="flex flex-col gap-3">
                  {awaiting.map((g) => (
                    <li key={g.id}>
                      <GameCard
                        game={g}
                        timeZone={team.timeZone}
                        showDay
                        highlight={entry?.id}
                      />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {entry && (
            <TeamStats team={team} schedule={games} timeZone={team.timeZone} />
          )}

          <InstagramPhotos
            id="photos"
            heading="Photos"
            cover={photos.cover}
            photos={photos.photos}
          />

          <MemberPhotos
            id="player-photos"
            about={team.name}
            photos={playerPhotos}
            shareHref={`/app/photos?team=${team.slug}`}
          />
        </div>

        <div className="flex flex-col gap-8">
          <section
            aria-labelledby="calendar"
            className="flex flex-col gap-3 rounded-card border-2 border-text bg-surface p-4 shadow-sticker"
          >
            <h2 id="calendar" className="text-h3">
              Never miss a game
            </h2>
            <p className="text-small text-text-muted">
              Subscribe once and every game lands in your calendar, in the
              league&apos;s time zone. Moves and rain-outs update on their own.
            </p>
            <div className="flex flex-wrap gap-2">
              <a href={links.webcal} className="btn btn-primary">
                Apple or Outlook
              </a>
              <a
                href={links.google}
                className="btn btn-secondary"
                target="_blank"
                rel="noopener noreferrer"
              >
                Google Calendar
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </div>
            <label className="flex flex-col gap-1 text-small font-bold">
              Or paste this link into any calendar app
              <input
                readOnly
                value={links.feed}
                className="min-h-11 rounded-input border border-border-strong bg-bg px-3 font-mono text-small font-normal"
              />
            </label>
          </section>

          <AllTimeRecord team={team} />

          <section aria-labelledby="roster" className="flex flex-col gap-3">
            <h2 id="roster" className="text-h2">
              Roster
            </h2>
            {roster.length === 0 ? (
              <p className="text-text-muted">
                The roster fills in as players join.
              </p>
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
                        {p.role === "captain" ? "Captain" : "Co-captain"}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {entry && (
            <p>
              <Link
                href={`/seasons/${entry.seasonSlug}/schedule?team=${team.slug}`}
                className="inline-flex min-h-11 items-center text-brand underline"
              >
                {team.name} on the full schedule
              </Link>
            </p>
          )}
        </div>
      </div>
    </>
  );
}

const OUTCOME: Record<string, string> = { W: "Win", L: "Loss", T: "Tie" };

function ResultsTable({
  games,
  teamId,
  timeZone,
}: {
  games: PublicGame[];
  teamId: string;
  timeZone: string;
}) {
  return (
    <table className="w-full text-left tabular-nums">
      <caption className="sr-only">Results, oldest first</caption>
      <thead className="text-small text-text-muted">
        <tr>
          <th scope="col" className="py-2 pr-2">
            Date
          </th>
          <th scope="col">Opponent</th>
          <th scope="col">Result</th>
          <th scope="col" className="text-right">
            Score
          </th>
        </tr>
      </thead>
      <tbody>
        {games.map((g) => {
          const outcome = outcomeFor(g, teamId) as string;
          const isA = g.teamA.id === teamId;
          const score =
            g.status === "forfeit"
              ? "Forfeit"
              : `${isA ? g.scoreA : g.scoreB}–${isA ? g.scoreB : g.scoreA}`;
          return (
            <tr key={g.id} className="border-t border-border">
              <td className="py-2 pr-2 text-small">
                {g.startsAt ? shortDay(g.startsAt, timeZone) : "–"}
              </td>
              <td>
                <Link
                  href={`/games/${g.id}`}
                  className="inline-flex min-h-11 items-center underline"
                >
                  {opponentOf(g, teamId).name}
                </Link>
              </td>
              <td>
                <span className={outcome === "W" ? "font-bold" : ""}>
                  <span aria-hidden="true">{outcome}</span>
                  <span className="sr-only">{OUTCOME[outcome]}</span>
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
