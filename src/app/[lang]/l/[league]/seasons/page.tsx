import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import { db } from "@/db/client";
import type { LeagueInfo } from "@/db/queries/leagues";
import { seasonList } from "@/db/queries/sitemap";
import { leagueHref } from "@/domain/league/paths";
import { readUnlessBuildHasNoDatabase } from "@/lib/build-phase";
import { publicLeague, withCanonical } from "@/lib/league/public";
import { PUBLIC_PAGE_LIFE, SEASONS_TAG, seasonTag } from "@/lib/public-cache";

/**
 * The page reads its league from the path outside any <Suspense> boundary,
 * so it has no generic fallback shell: a league the build didn't list, or a
 * page an admin's change just expired, is rendered in full before it is
 * served, then kept (as the game page does). Without this, expiring the
 * route makes its next visit fail (ADR 0048).
 */
export const instant = false;

const METADATA: Metadata = {
  title: "Schedules and standings",
  description:
    "Every season of the league: schedules, standings and how to sign up for the next one.",
};

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/l/[league]/seasons">): Promise<Metadata> {
  return withCanonical(params, METADATA, "/seasons");
}

/** How a season's status reads to a visitor. */
const STATUS: Record<string, string> = {
  registration_open: "Sign-ups open",
  registration_closed: "Coming up",
  in_progress: "Being played",
  playoffs: "Playoffs",
  completed: "Finished",
};

const day = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T12:00:00Z`));

export default function SeasonsPage({
  params,
}: PageProps<"/[lang]/l/[league]/seasons">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 md:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1">Seasons</h1>
        <p className="text-body-lg text-text-muted">
          When everyone plays, who&apos;s on top, and how to get in on the next
          one.
        </p>
      </header>
      <LeagueSeasons params={params} />
    </main>
  );
}

/** The league comes from the path (ADR 0048), never a cookie. */
async function LeagueSeasons({
  params,
}: {
  params: PageProps<"/[lang]/l/[league]/seasons">["params"];
}) {
  const league = await publicLeague((await params).league, "/seasons");
  return <Seasons league={league} />;
}

/**
 * Cached and part of the static page: changing a season's name, dates or
 * status expires the list's tag (refreshSeasonPages), and a result expires
 * that season's tag.
 */
async function Seasons({ league }: { league: LeagueInfo }) {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  cacheTag(SEASONS_TAG);
  const seasons =
    (await readUnlessBuildHasNoDatabase(() => seasonList(db, league.id))) ?? [];
  if (seasons.length > 0) cacheTag(...seasons.map((s) => seasonTag(s.id)));

  if (seasons.length === 0)
    return (
      <p className="text-text-muted">
        The first season goes up here as soon as it opens for sign-ups.
      </p>
    );

  return (
    <ul className="flex flex-col gap-4">
      {seasons.map((s) => (
        <li
          key={s.id}
          className="flex flex-col gap-2 rounded-card border-2 border-text bg-surface p-4"
        >
          <h2 className="text-h3">{s.name}</h2>
          <p className="text-small text-text-muted">
            {STATUS[s.status] ?? s.status} · {day(s.startsOn)} to{" "}
            {day(s.endsOn)}
          </p>
          <p className="flex flex-wrap gap-x-6 gap-y-1">
            <Link
              href={leagueHref(league, `/seasons/${s.slug}/schedule`)}
              className="inline-flex min-h-11 items-center underline"
            >
              Schedule<span className="sr-only"> for {s.name}</span>
            </Link>
            <Link
              href={leagueHref(league, `/seasons/${s.slug}/standings`)}
              className="inline-flex min-h-11 items-center underline"
            >
              Standings<span className="sr-only"> for {s.name}</span>
            </Link>
            {s.status === "registration_open" && (
              <Link
                href="/sign-in"
                className="inline-flex min-h-11 items-center font-bold underline"
              >
                Sign up<span className="sr-only"> for {s.name}</span>
              </Link>
            )}
          </p>
        </li>
      ))}
    </ul>
  );
}
