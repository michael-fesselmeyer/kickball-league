import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { db } from "@/db/client";
import { assignerInputs, staffDays } from "@/db/queries/referee-pool";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { localDate } from "@/domain/books/ledger-csv";
import { proposeReferees } from "@/domain/referees/assign";
import { activeLeagueId } from "@/lib/league/active";
import { requirePermission } from "@/lib/auth/permission";
import { acceptAllAction, assignOneAction } from "./actions";

export const metadata: Metadata = { title: "Assign refs" };

export default function AssignPage(
  props: PageProps<"/app/admin/seasons/[season]/referees/assign">,
) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Working out who can ref…</PageLoading>}>
        <Assign {...props} />
      </Suspense>
    </main>
  );
}

const WHY: Record<"nobody_available" | "everyone_busy", string> = {
  nobody_available: "Nobody in the pool said they can work this time.",
  everyone_busy:
    "Everyone free then plays in it, has another game, or would have to change fields between back-to-back games.",
};

/** Why accepted pairs were skipped, from `acceptProposals`. */
const SKIPPED: Record<string, string> = {
  closed:
    "the game no longer needs a ref (it has one, has started or was called off).",
  not_in_pool: "the ref is no longer in the pool.",
  clash: "the ref plays in it, or plays or refs another game then.",
  taken: "another pair or admin took the game first.",
};

async function Assign({
  params,
  searchParams,
}: PageProps<"/app/admin/seasons/[season]/referees/assign">) {
  const { season: slug } = await params;
  const query = await searchParams;
  const base = `/app/admin/seasons/${slug}/referees`;
  await requirePermission("referee.manage", { next: `${base}/assign` });
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  if (!season) notFound();
  const day =
    typeof query.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(query.day)
      ? query.day
      : null;
  const now = new Date();
  const all = await assignerInputs(db, {
    seasonId: season.id,
    leagueId: season.leagueId,
    timeZone: season.timeZone,
    day: null,
    now,
  });
  const days = staffDays(all.games, season.timeZone);
  const games =
    day === null
      ? all.games
      : all.games.filter(
          (g) => localDate(new Date(g.startsAt), season.timeZone) === day,
        );
  const proposal = proposeReferees({ ...all, games });
  const nameOf = new Map(all.refs.map((r) => [r.id, r.name]));
  const whyOf = new Map(proposal.unfilled.map((u) => [u.gameId, u.reason]));
  const dayLabel = (d: string) =>
    new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${d}T12:00:00Z`));
  const time = (ms: number) =>
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: season.timeZone,
    }).format(ms);
  const assigned = Number(query.assigned);
  const skipped = Number(query.skipped);
  const byDay = Map.groupBy(games, (g) =>
    localDate(new Date(g.startsAt), season.timeZone),
  );
  const shares = [...proposal.loads]
    .map(([id, n]) => ({ id, name: nameOf.get(id) ?? "", n }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href={base} className="underline">
          {season.name} referees
        </Link>
        <h1 className="text-h1">Assign refs</h1>
        <p className="text-text-muted">
          A proposal for the games still without a ref. It only uses refs who
          said they can work that time, never puts a ref on their own
          team&rsquo;s game, keeps each ref on one field for back-to-back games,
          and spreads games evenly over the season.
        </p>
      </header>

      {Number.isInteger(assigned) && query.assigned !== undefined && (
        <p role="status" className="rounded-lg border border-success p-3">
          {assigned === 1 ? "1 ref assigned" : `${assigned} refs assigned`}.
          {skipped > 0 &&
            ` ${skipped} skipped: ${SKIPPED[typeof query.why === "string" && query.why in SKIPPED ? query.why : "closed"]}`}
        </p>
      )}

      <nav aria-label="Game days" className="flex flex-wrap gap-2">
        <Link
          href={`${base}/assign`}
          aria-current={day === null ? "page" : undefined}
          className={`btn ${day === null ? "btn-primary" : "btn-secondary"}`}
        >
          Whole season
        </Link>
        {days.map((d) => (
          <Link
            key={d}
            href={`${base}/assign?day=${d}`}
            aria-current={day === d ? "page" : undefined}
            className={`btn ${day === d ? "btn-primary" : "btn-secondary"}`}
          >
            {dayLabel(d)}
          </Link>
        ))}
      </nav>

      {all.refs.length === 0 ? (
        <p className="rounded-lg border border-border p-4">
          The ref pool is empty.{" "}
          <Link href={`${base}#pool`} className="underline">
            Add refs to the pool
          </Link>{" "}
          first.
        </p>
      ) : games.length === 0 ? (
        <p className="rounded-lg border border-border p-4">
          Every game {day ? "that day" : "still to play"} has a ref.
        </p>
      ) : (
        <>
          <form
            action={acceptAllAction.bind(null, slug)}
            className="flex flex-wrap items-center gap-3"
          >
            {day && <input type="hidden" name="day" value={day} />}
            {[...proposal.assignments].map(([gameId, refId]) => (
              <input
                key={gameId}
                type="hidden"
                name="pair"
                value={`${gameId}:${refId}`}
              />
            ))}
            <SubmitButton
              disabled={proposal.assignments.size === 0}
              className="btn btn-primary"
            >
              Accept all {proposal.assignments.size}
            </SubmitButton>
            <span className="text-small text-text-muted">
              {proposal.assignments.size} of {games.length} games have a
              proposed ref.
            </span>
          </form>

          {[...byDay].map(([d, dayGames]) => (
            <section
              key={d}
              aria-label={dayLabel(d)}
              className="flex flex-col gap-1"
            >
              <h2 className="text-h3">{dayLabel(d)}</h2>
              <ul className="flex flex-col">
                {dayGames.map((g) => {
                  const proposed = proposal.assignments.get(g.id);
                  const why = whyOf.get(g.id);
                  const matchup = `${g.teamAName} vs ${g.teamBName}`;
                  const choices = all.refs.filter(
                    (r) => !g.teamSeasonIds.some((t) => r.teamSeasonIds.has(t)),
                  );
                  return (
                    <li
                      key={g.id}
                      className="flex flex-col gap-2 border-t border-border py-3"
                    >
                      <span>
                        {time(g.startsAt)} · {g.fieldName}
                        <span className="block text-text-muted">{matchup}</span>
                      </span>
                      {why && (
                        <p className="text-small text-text-muted">{WHY[why]}</p>
                      )}
                      <form
                        action={assignOneAction.bind(null, slug, g.id)}
                        className="flex flex-wrap items-end gap-2"
                      >
                        {day && <input type="hidden" name="day" value={day} />}
                        <label className="flex flex-col gap-1 text-small">
                          Ref
                          <select
                            name="userId"
                            defaultValue={proposed ?? ""}
                            required
                            aria-label={`Ref for ${matchup}`}
                            className="min-h-11 rounded-input border border-border-strong bg-surface px-3 text-body"
                          >
                            <option value="" disabled>
                              Pick a ref
                            </option>
                            {choices.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                                {r.id === proposed
                                  ? " (proposed)"
                                  : r.available.has(g.startsAt)
                                    ? ""
                                    : " (didn't say they're free)"}
                              </option>
                            ))}
                          </select>
                        </label>
                        <SubmitButton className="btn btn-secondary">
                          {proposed ? "Accept" : "Assign"}
                          <span className="sr-only"> for {matchup}</span>
                        </SubmitButton>
                      </form>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          <section aria-labelledby="shares" className="flex flex-col gap-2">
            <h2 id="shares" className="text-h3">
              Games each ref would have this season
            </h2>
            <ul className="text-small">
              {shares.map((s) => (
                <li key={s.id}>
                  {s.name}: {s.n}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  );
}
