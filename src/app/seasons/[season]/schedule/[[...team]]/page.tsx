import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { PUBLIC_PAGE_LIFE, seasonTag } from "@/lib/public-cache";
import { NO_SEASON, publicSeasonParams } from "@/lib/static-params";
import { SeasonSchedule } from "../season-schedule";

type Props = PageProps<"/seasons/[season]/schedule/[[...team]]">;

/**
 * The whole page is static, and a view the build didn't list is rendered in
 * full on its first visit instead of streaming in behind a loading state.
 * Without a <Suspense> boundary around it, the schedule is part of the first
 * paint: React moves a finished boundary larger than its progressive chunk
 * (12.8 kB) to the end of the document, and the browser could paint the
 * fallback first and reveal the schedule up to 300 ms later.
 */
export const ensureStatic = "navigation";

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
      <Schedule {...props} />
    </main>
  );
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
