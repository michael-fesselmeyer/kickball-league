import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { refereeBoard } from "@/db/queries/referees";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { requirePermission } from "@/lib/auth/permission";
import { assignRefereeAction, unassignRefereeAction } from "./actions";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Referees" };

export default function RefereesPage(
  props: PageProps<"/app/admin/seasons/[season]/referees">,
) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Referees {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<string, string> = {
  no_account:
    "Nobody has an account with that email yet. Ask them to sign in once, then assign them.",
  unknown_game: "That game is gone.",
};
const NOTICES: Record<string, string> = {
  assigned: "Referee assigned. They'll see the game on their home screen.",
  removed: "Referee removed.",
};

async function Referees({
  params,
  searchParams,
}: PageProps<"/app/admin/seasons/[season]/referees">) {
  const { season: slug } = await params;
  const query = await searchParams;
  await requirePermission("referee.manage", {
    next: `/app/admin/seasons/${slug}/referees`,
  });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  const games = await refereeBoard(db, season.id);
  const days = Map.groupBy(games, (g) =>
    new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      timeZone: season.timeZone,
    }).format(g.startsAt),
  );
  const time = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: season.timeZone,
    }).format(d);
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice] : undefined;
  const covered = games.filter((g) => g.referee).length;

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href={`/app/admin/seasons/${slug}`} className="underline">
          {season.name}
        </Link>
        <h1 className="text-h1">Referees</h1>
        <p className="text-text-muted">
          {covered} of {games.length} games have a referee. A referee enters the
          final score from their phone.
        </p>
      </header>
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg border border-success p-3">
          {notice}
        </p>
      )}
      {games.length === 0 && (
        <p className="text-text-muted">No games are placed yet.</p>
      )}
      {[...days].map(([day, dayGames]) => (
        <section key={day} aria-label={day} className="flex flex-col gap-1">
          <h2 className="text-h3">{day}</h2>
          <ul className="flex flex-col">
            {dayGames.map((g) => (
              <li
                key={g.id}
                id={`game-${g.id}`}
                className="flex flex-col gap-2 border-t border-border py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <span>
                  {time(g.startsAt)} · {g.fieldName}
                  <span className="block text-text-muted">
                    {g.teamAName} vs {g.teamBName}
                  </span>
                </span>
                {g.referee ? (
                  <form
                    action={unassignRefereeAction.bind(null, slug, g.id)}
                    className="flex items-center gap-3"
                  >
                    <span>{g.referee.name || g.referee.email}</span>
                    <SubmitButton
                      className="underline"
                      aria-label={`Remove the referee from ${g.teamAName} vs ${g.teamBName}`}
                    >
                      Remove
                    </SubmitButton>
                  </form>
                ) : (
                  <form
                    action={assignRefereeAction.bind(null, slug, g.id)}
                    className="flex items-center gap-2"
                  >
                    <input
                      name="email"
                      type="email"
                      required
                      placeholder="Referee's email"
                      aria-label={`Referee's email for ${g.teamAName} vs ${g.teamBName}`}
                      className="w-48 rounded-md border border-border bg-surface px-2 py-1"
                    />
                    <SubmitButton className="underline">Assign</SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
