import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BracketBoard, BracketList, Champion } from "@/components/bracket";
import { db } from "@/db/client";
import { bracketViews } from "@/db/queries/playoffs";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { PUBLIC_PAGE_LIFE, seasonTag } from "@/lib/public-cache";
import { NO_SEASON, publicSeasonParams } from "@/lib/static-params";

export const metadata: Metadata = {
  title: "Playoff bracket",
  description:
    "The playoff bracket: seeds from the final standings, game times and fields, and who moves on.",
};

type Props = PageProps<"/seasons/[season]/bracket/[[...view]]">;

/**
 * Static, like the schedule (ADR 0029): each public season's bracket is
 * prerendered, and another view is rendered in full on its first visit.
 */
export const ensureStatic = "navigation";

export async function generateStaticParams() {
  return (await publicSeasonParams()).map((p) => ({ ...p, view: [] }));
}

/**
 * The list view arrives as `?view=list`. src/proxy.ts rewrites it to the
 * optional `[[...view]]` segment, so the page never reads the query string.
 */
export default async function BracketPage({ params }: Props) {
  const { season: slug, view } = await params;
  // The build's placeholder when it had no database to read.
  if (slug === NO_SEASON) notFound();
  const asList = view?.[0] === "list";
  if (view !== undefined && view.length > 0 && !asList) notFound();
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10">
      <Bracket slug={slug} asList={asList} />
    </main>
  );
}

/** Cached; publishing a bracket or a final playoff score expires it. */
async function Bracket({ slug, asList }: { slug: string; asList: boolean }) {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  const season = await seasonBySlug(db, slug);
  // Drafts are the league's work in progress, not public.
  if (!season || season.status === "draft") notFound();
  cacheTag(seasonTag(season.id));
  // One bracket, or one per division without a combined final (ADR 0040).
  const brackets = await bracketViews(db, season.id);
  const base = `/seasons/${season.slug}/bracket`;

  return (
    <>
      <header className="flex flex-col gap-2">
        <p className="text-text-muted">{season.name}</p>
        <h1 className="text-h1">Playoffs</h1>
        <nav aria-label="Season" className="flex flex-wrap gap-x-4 gap-y-1">
          <Link
            href={`/seasons/${season.slug}/schedule`}
            className="inline-flex min-h-11 items-center text-brand underline"
          >
            Schedule
          </Link>
          <Link
            href={`/seasons/${season.slug}/standings`}
            className="inline-flex min-h-11 items-center text-brand underline"
          >
            Standings
          </Link>
        </nav>
      </header>

      {brackets.length === 0 ? (
        <section className="flex flex-col items-start gap-3 rounded-card border border-border bg-surface p-6">
          <p className="sticker">Coming soon</p>
          <p className="max-w-prose text-body-lg">
            The bracket is set from the final standings once the regular season
            ends. Top teams get byes when the field is uneven.
          </p>
        </section>
      ) : (
        <>
          <nav aria-label="Bracket view" className="flex gap-2">
            <Link
              href={base}
              aria-current={asList ? undefined : "page"}
              className={`btn ${asList ? "btn-secondary" : "btn-primary"}`}
            >
              Bracket
            </Link>
            <Link
              href={`${base}?view=list`}
              aria-current={asList ? "page" : undefined}
              className={`btn ${asList ? "btn-primary" : "btn-secondary"}`}
            >
              List
            </Link>
          </nav>
          {brackets.map((bracket) => {
            const division = bracket.division;
            const body = (
              <>
                <Champion bracket={bracket} />
                {asList ? (
                  <BracketList
                    bracket={bracket}
                    headingLevel={division ? 3 : 2}
                    idPrefix={division ? `${division.slug}-` : ""}
                  />
                ) : (
                  <BracketBoard
                    bracket={bracket}
                    headingLevel={division ? 3 : 2}
                    {...(division ? { name: division.name } : {})}
                  />
                )}
              </>
            );
            return division ? (
              <section
                key={bracket.id}
                aria-labelledby={`bracket-${division.slug}`}
                className="flex flex-col gap-4"
              >
                <h2 id={`bracket-${division.slug}`} className="text-h2">
                  {division.name}
                </h2>
                {body}
              </section>
            ) : (
              <div key={bracket.id} className="flex flex-col gap-4">
                {body}
              </div>
            );
          })}
          <p className="max-w-prose text-small text-text-muted">
            Seeds come from the final standings, ties broken by the
            league&apos;s tiebreakers. Playoff games can&apos;t end in a tie,
            and winners move on as soon as a score is final.
          </p>
        </>
      )}
    </>
  );
}
