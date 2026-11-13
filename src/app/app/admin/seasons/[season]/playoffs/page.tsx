import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BracketBoard, Champion } from "@/components/bracket";
import { db } from "@/db/client";
import { bracketView, playoffPreview } from "@/db/queries/playoffs";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import {
  byeSeeds,
  MAX_PLAYOFF_TEAMS,
  MIN_PLAYOFF_TEAMS,
} from "@/domain/playoffs/playoffs";
import { dayHeading } from "@/domain/schedule/format";
import { requirePermission } from "@/lib/auth/permission";
import { makeBracket, publishDraftBracket } from "./actions";

export const metadata: Metadata = { title: "Playoffs" };

export default function PlayoffsAdminPage(
  props: PageProps<"/app/admin/seasons/[season]/playoffs">,
) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<p>Loading…</p>}>
        <Playoffs {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<string, string> = {
  bad_input: "Pick how many teams make it and a playoff date.",
  no_schedule: "Publish the regular-season schedule first.",
  already_published: "This season's bracket is already published.",
  too_few_teams:
    "That many teams can't make it. Pick at least 2 and no more than the teams still in the season.",
  no_slots:
    "No free slots on or after that date. Add a permit for playoff day on the fields page.",
  no_bracket: "Make a bracket first.",
  stale:
    "A newer schedule was published after this bracket was drafted. Make the bracket again so it keeps those changes.",
  has_violations: "The draft breaks a scheduling rule. Make the bracket again.",
};

async function Playoffs({
  params,
  searchParams,
}: PageProps<"/app/admin/seasons/[season]/playoffs">) {
  const { season: slug } = await params;
  const query = await searchParams;
  const page = `/app/admin/seasons/${slug}/playoffs`;
  await requirePermission("schedule.manage", { next: page });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  const [preview, bracket] = await Promise.all([
    playoffPreview(db, season.id),
    bracketView(db, season.id, { includeDraft: true }),
  ]);
  if (!preview) notFound();
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const status = query.drafted
    ? "Bracket drafted. Check it, then publish it."
    : query.published
      ? "Bracket published. Winners move on as scores become final."
      : null;
  const canSeed = !bracket || bracket.status === "draft";
  // Re-seeding starts from the draft's size, or the league's default.
  const defaultTeams = Math.max(
    MIN_PLAYOFF_TEAMS,
    bracket?.size ?? preview.defaultTeams,
  );

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link
          href={`/app/admin/seasons/${slug}`}
          className="inline-flex min-h-11 items-center self-start underline"
        >
          {season.name}
        </Link>
        <h1 className="text-h1">Playoffs</h1>
        <p className="max-w-prose text-text-muted">
          Seeds come from the standings with the season&apos;s tiebreakers. The
          bracket is placed on the free slots from the date you pick and saved
          as a schedule version. Winners move on as playoff scores become final.
        </p>
      </header>
      {status && (
        <p role="status" className="rounded-lg border border-success p-3">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}

      {bracket && (
        <section aria-labelledby="bracket" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 id="bracket" className="text-h2">
              {bracket.status === "draft" ? "Draft bracket" : "Bracket"}
            </h2>
            {bracket.status === "draft" ? (
              <form action={publishDraftBracket.bind(null, slug)}>
                <button type="submit" className="btn btn-primary">
                  Publish the bracket
                </button>
              </form>
            ) : (
              <Link
                href={`/seasons/${slug}/bracket`}
                className="btn btn-secondary"
              >
                See the public bracket
              </Link>
            )}
          </div>
          <Champion bracket={bracket} />
          {bracket.diagnostics.length > 0 && (
            <ul className="list-disc pl-5 text-small">
              {bracket.diagnostics.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
          <BracketBoard bracket={bracket} link={false} headingLevel={3} />
          {bracket.status === "draft" && (
            <p className="text-small text-text-muted">
              Publishing puts the first games on the schedule and moves the
              season into playoffs. Later games are added in their reserved
              slots as soon as both teams are known.
            </p>
          )}
        </section>
      )}
      {canSeed && (
        <section aria-labelledby="seed" className="flex flex-col gap-4">
          <h2 id="seed" className="text-h2">
            {bracket ? "Make the bracket again" : "Seed the bracket"}
          </h2>
          {!preview.hasPublishedSchedule ? (
            <p>{ERRORS.no_schedule}</p>
          ) : preview.dates.length === 0 ? (
            <p>
              There are no free slots after the regular season.{" "}
              <Link
                href={`/app/admin/seasons/${slug}/fields`}
                className="underline"
              >
                Add a permit for playoff day
              </Link>
              .
            </p>
          ) : (
            <form
              action={makeBracket.bind(null, slug)}
              className="flex flex-wrap items-end gap-4"
            >
              <label className="flex flex-col gap-1">
                Teams in the playoffs
                <input
                  name="teams"
                  type="number"
                  min={MIN_PLAYOFF_TEAMS}
                  max={Math.min(MAX_PLAYOFF_TEAMS, preview.eligibleCount)}
                  required
                  defaultValue={defaultTeams}
                  className="min-h-11 w-24 rounded-input border border-border-strong bg-surface px-3"
                />
              </label>
              <label className="flex flex-col gap-1">
                Playoff day
                <select
                  name="date"
                  required
                  className="min-h-11 rounded-input border border-border-strong bg-surface px-3"
                >
                  {preview.dates.map((d) => (
                    <option key={d.date} value={d.date}>
                      {dayHeading(d.date)} ({d.free} free slots)
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="btn btn-primary">
                {bracket ? "Replace the draft" : "Make the bracket"}
              </button>
            </form>
          )}
          <p className="text-small text-text-muted">
            With {defaultTeams} teams,{" "}
            {byeSeeds(defaultTeams).length === 0
              ? "nobody gets a bye."
              : `seeds ${byeSeeds(defaultTeams).join(", ")} get a first-round bye.`}{" "}
            Teams that withdrew are skipped.
          </p>
          <table className="w-full max-w-xl text-left tabular-nums">
            <caption className="sr-only">Standings used for seeding</caption>
            <thead className="text-small text-text-muted">
              <tr>
                <th scope="col" className="py-2 pr-2">
                  #
                </th>
                <th scope="col">Team</th>
                <th scope="col" className="text-right">
                  W-L-T
                </th>
                <th scope="col" className="text-right">
                  Seed
                </th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                let seed = 0;
                return preview.standings.map((r) => {
                  const s = r.eligible ? ++seed : null;
                  return (
                    <tr key={r.teamId} className="border-t border-border">
                      <td className="py-2 pr-2 text-text-muted">{r.rank}</td>
                      <th scope="row" className="font-normal">
                        {r.name}
                        {!r.eligible && (
                          <span className="text-text-muted"> (withdrawn)</span>
                        )}
                      </th>
                      <td className="text-right">
                        {r.wins}-{r.losses}-{r.ties}
                      </td>
                      <td className="text-right">
                        {s !== null && s <= defaultTeams ? s : "–"}
                      </td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
