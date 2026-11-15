import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/db/client";
import { openFormOf, type PublicForm } from "@/db/queries/interest";
import type { LeagueId } from "@/domain/ids";
import { readUnlessBuildHasNoDatabase } from "@/lib/build-phase";
import { publicLeague, withCanonical } from "@/lib/league/public";
import { INTEREST_TAG, PUBLIC_PAGE_LIFE } from "@/lib/public-cache";
import { InterestForm } from "./interest-form";

/**
 * The page reads its league from the path outside any <Suspense> boundary,
 * as the rules page does (ADR 0048): a league the build didn't list is
 * rendered in full before it is served, then kept.
 */
export const instant = false;

const METADATA: Metadata = {
  title: "Would you play?",
  description:
    "Tell the league which new night, park or format you would play, and how many friends might join. No account needed.",
};

export function generateMetadata({
  params,
}: PageProps<"/l/[league]/interest">): Promise<Metadata> {
  return withCanonical(params, METADATA, "/interest");
}

/**
 * Static HTML: the open form is read once inside `use cache` and kept until
 * an admin opens, changes or closes one (refreshInterestPage) or
 * PUBLIC_PAGE_LIFE runs out. It shows no totals and reads no answers.
 */
async function cachedForm(leagueId: LeagueId): Promise<PublicForm | null> {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  cacheTag(INTEREST_TAG);
  return readUnlessBuildHasNoDatabase(() => openFormOf(db, leagueId));
}

export default async function InterestPage({
  params,
}: PageProps<"/l/[league]/interest">) {
  const league = await publicLeague((await params).league, "/interest");
  const form = await cachedForm(league.id);
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-12 md:px-6">
      {form && form.options.length > 0 ? (
        <>
          <header className="flex flex-col gap-2">
            <h1 className="text-h1">{form.title}</h1>
            <p className="text-body-lg text-text-muted">
              {form.intro ||
                `${league.name} is thinking about growing. Tell us what you would play, so we know where to book.`}{" "}
              No account needed.
            </p>
          </header>
          <InterestForm formId={form.id} options={form.options} />
        </>
      ) : (
        <header className="flex flex-col gap-2">
          <h1 className="text-h1">Would you play?</h1>
          <p className="text-body-lg text-text-muted">
            {league.name} isn&apos;t asking about new nights or parks right now.
            Check back soon.
          </p>
        </header>
      )}
    </main>
  );
}
