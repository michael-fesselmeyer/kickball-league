import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { db } from "@/db/client";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { activeLeagueId } from "@/lib/league/active";
import { seasonCardSummary } from "@/db/queries/season-cards";
import { requirePermission } from "@/lib/auth/permission";
import { buildSeasonCardsAction } from "./actions";

export const metadata: Metadata = { title: "Season cards" };

type Props = PageProps<"/app/admin/seasons/[season]/cards">;

export default function SeasonCardsAdminPage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Cards {...props} />
      </Suspense>
    </main>
  );
}

/** Messages by error code; an unknown code from the URL finds nothing. */
const ERRORS: Record<string, string> = {
  not_completed:
    "The cards can be built once the season is completed. Mark it completed first.",
  not_found: "That season is gone.",
};

const count = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

async function Cards({ params, searchParams }: Props) {
  const { season: slug } = await params;
  const query = await searchParams;
  await requirePermission("season.manage", {
    next: `/app/admin/seasons/${slug}/cards`,
  });
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  if (!season) notFound();
  const summary = await seasonCardSummary(db, season.id);
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const built = typeof query.built === "string" ? Number(query.built) : null;
  const told = typeof query.told === "string" ? Number(query.told) : 0;
  const completed = season.status === "completed";

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link href={`/app/admin/seasons/${slug}`} className="underline">
          {season.name}
        </Link>
        <h1 className="text-h1">Season cards</h1>
        <p>
          &ldquo;Your season in kickball&rdquo;: each player on a roster gets a
          card with their games, their team&apos;s runs, record and finish,
          their awards and their best game. Cards are private until the player
          makes the link public.
        </p>
      </header>
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {built !== null && Number.isFinite(built) && (
        <p role="status" className="rounded-lg border border-success p-3">
          {count(built, "card")} ready.{" "}
          {told > 0
            ? `${count(told, "player")} will get a message that theirs is ready.`
            : "Everyone had already been told, so no messages went out."}
        </p>
      )}
      <section aria-labelledby="status" className="flex flex-col gap-3">
        <h2 id="status" className="text-h2">
          {season.name}
        </h2>
        {summary.cards > 0 ? (
          <p>
            {count(summary.cards, "card")}, {summary.shared} shared by their
            players.
          </p>
        ) : (
          <p className="text-text-muted">No cards yet.</p>
        )}
        {completed ? (
          <form action={buildSeasonCardsAction.bind(null, slug)}>
            <SubmitButton className="btn btn-primary">
              {summary.cards > 0
                ? "Refresh the cards"
                : "Build the cards and tell players"}
            </SubmitButton>
          </form>
        ) : (
          <p className="text-text-muted">
            The cards can be built once the season is completed.
          </p>
        )}
        <p className="text-small text-text-muted">
          Refreshing updates the numbers after a late score change and keeps
          each player&apos;s sharing choice. Each player is told once, the first
          time their card is built, with a message that can wait for the
          morning.
        </p>
      </section>
    </>
  );
}
