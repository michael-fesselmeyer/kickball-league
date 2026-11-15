import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { refereePool } from "@/db/queries/referee-pool";
import { refereeBoard } from "@/db/queries/referees";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { requirePermission } from "@/lib/auth/permission";
import {
  addToPoolAction,
  assignRefereeAction,
  removeFromPoolAction,
  unassignRefereeAction,
} from "./actions";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { activeLeagueId } from "@/lib/league/active";

export const metadata: Metadata = { title: "Referees" };

export default function RefereesPage(
  props: PageProps<"/[lang]/app/admin/seasons/[season]/referees">,
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
  own_team:
    "They play for one of those teams. If they ref it, their report counts as their team's and only the other team can confirm it. Tick the box to assign them anyway, or pick someone else.",
  already_in_pool: "They're already in the ref pool.",
};
const NOTICES: Record<string, string> = {
  assigned: "Referee assigned. They'll see the game on their home screen.",
  removed: "Referee removed.",
  pool_added:
    "Added to the ref pool. They can now say when they can work, from their home screen.",
  pool_removed:
    "Taken out of the ref pool. Games they already referee stay theirs.",
};

async function Referees({
  params,
  searchParams,
}: PageProps<"/[lang]/app/admin/seasons/[season]/referees">) {
  const { season: slug } = await params;
  const query = await searchParams;
  await requirePermission("referee.manage", {
    next: `/app/admin/seasons/${slug}/referees`,
  });
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  if (!season) notFound();
  const [games, pool] = await Promise.all([
    refereeBoard(db, season.id),
    refereePool(db, season.leagueId),
  ]);
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
        <nav aria-label="Referees" className="mt-2 flex flex-wrap gap-2">
          <Link
            href={`/app/admin/seasons/${slug}/referees/assign`}
            className="btn btn-primary"
          >
            Assign refs
          </Link>
          <Link
            href={`/app/admin/seasons/${slug}/referees/pay`}
            className="btn btn-secondary"
          >
            Pay sheet
          </Link>
        </nav>
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
      <section aria-labelledby="pool" className="flex flex-col gap-2">
        <h2 id="pool" className="text-h3">
          Ref pool
        </h2>
        <p className="text-small text-text-muted">
          The people &ldquo;Assign refs&rdquo; proposes. Each one says which
          game times they can work from their home screen.
        </p>
        {pool.length === 0 ? (
          <p className="text-text-muted">Nobody is in the pool yet.</p>
        ) : (
          <ul className="flex flex-col">
            {pool.map((p) => (
              <li
                key={p.userId}
                className="flex items-center justify-between gap-3 border-t border-border py-2"
              >
                <span>{p.name || p.email}</span>
                <form action={removeFromPoolAction.bind(null, slug, p.userId)}>
                  <SubmitButton className="inline-flex min-h-11 items-center underline">
                    Remove
                    <span className="sr-only">
                      {" "}
                      {p.name || p.email} from the ref pool
                    </span>
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form
          action={addToPoolAction.bind(null, slug)}
          className="flex flex-wrap items-end gap-2"
        >
          <label className="flex flex-col gap-1">
            Add a ref by email
            <input
              name="email"
              type="email"
              required
              className="min-h-11 w-64 rounded-input border border-border-strong bg-surface px-3"
            />
          </label>
          <SubmitButton className="btn btn-secondary">
            Add to the pool
          </SubmitButton>
        </form>
      </section>
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
                      className="min-h-11 underline"
                      aria-label={`Remove the referee from ${g.teamAName} vs ${g.teamBName}`}
                    >
                      Remove
                    </SubmitButton>
                  </form>
                ) : (
                  <form
                    action={assignRefereeAction.bind(null, slug, g.id)}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <input
                      name="email"
                      type="email"
                      required
                      placeholder="Referee's email"
                      aria-label={`Referee's email for ${g.teamAName} vs ${g.teamBName}`}
                      className="w-48 rounded-md border border-border bg-surface px-2 py-1"
                    />
                    {query.error === "own_team" && query.game === g.id && (
                      <label className="flex items-center gap-2 text-small">
                        <input
                          type="checkbox"
                          name="ownTeamOk"
                          className="size-5"
                        />
                        They play in this game. Assign anyway: their report
                        counts as their team&rsquo;s.
                      </label>
                    )}
                    <SubmitButton className="min-h-11 underline">
                      Assign
                    </SubmitButton>
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
