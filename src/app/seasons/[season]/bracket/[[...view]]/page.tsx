import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BracketBoard, BracketList, Champion } from "@/components/bracket";
import { db } from "@/db/client";
import { bracketViews } from "@/db/queries/playoffs";
import { seasonBySlug } from "@/db/queries/schedule-screen";

export const metadata: Metadata = {
  title: "Playoff bracket",
  description:
    "The playoff bracket: seeds from the final standings, game times and fields, and who moves on.",
};

export default function BracketPage(
  props: PageProps<"/seasons/[season]/bracket">,
) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10">
      <Suspense fallback={<p>Loading the bracket…</p>}>
        <Bracket {...props} />
      </Suspense>
    </main>
  );
}

async function Bracket({
  params,
  searchParams,
}: PageProps<"/seasons/[season]/bracket">) {
  const { season: slug } = await params;
  const { view } = await searchParams;
  const season = await seasonBySlug(db, slug);
  // Drafts are the league's work in progress, not public.
  if (!season || season.status === "draft") notFound();
  // One bracket, or one per division without a combined final (ADR 0040).
  const brackets = await bracketViews(db, season.id);
  const asList = view === "list";
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
