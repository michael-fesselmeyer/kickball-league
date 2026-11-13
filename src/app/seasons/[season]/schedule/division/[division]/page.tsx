import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { seasonDivisions } from "@/db/queries/divisions";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { PUBLIC_PAGE_LIFE, seasonTag } from "@/lib/public-cache";
import { NO_SEASON, publicDivisionParams } from "@/lib/static-params";
import { SeasonSchedule } from "../../season-schedule";

type Props = PageProps<"/seasons/[season]/schedule/division/[division]">;

/** Static, as the season's full schedule is (see its page). */
export const ensureStatic = "navigation";

/** Every public season's divisions are prerendered at build time. */
export async function generateStaticParams() {
  return publicDivisionParams();
}

async function cachedDivision(slug: string, divisionSlug: string) {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  const season = await seasonBySlug(db, slug);
  if (!season) return null;
  cacheTag(seasonTag(season.id));
  const division = (await seasonDivisions(db, season.id)).find(
    (d) => d.slug === divisionSlug,
  );
  return { season, division: division ?? null };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { season: slug, division } = await params;
  if (slug === NO_SEASON) return { title: "Schedule" };
  const found = await cachedDivision(slug, division);
  return {
    title:
      found?.division && found.season.status !== "draft"
        ? `${found.season.name} ${found.division.name} schedule`
        : "Schedule",
  };
}

export default function DivisionSchedulePage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10 md:px-6">
      <DivisionSchedule {...props} />
    </main>
  );
}

/**
 * One division's games, crossovers included (ADR 0035). The division comes
 * from the path, never the query string, so the page is static HTML.
 */
async function DivisionSchedule({ params }: Props) {
  const { season: slug, division } = await params;
  // The build's placeholder when it had no database to read.
  if (slug === NO_SEASON) notFound();
  return <SeasonSchedule slug={slug} divisionSlug={division} />;
}
