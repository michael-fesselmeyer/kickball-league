import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { db } from "@/db/client";
import { dayGames, statusesFrom } from "@/db/queries/game-day-status";
import { publishedSchedule } from "@/db/queries/public-schedule";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import {
  dayLine,
  gameStatus,
  gameWords,
  updatedWords,
} from "@/domain/gameday/status";
import { kickoff, shortDay } from "@/domain/schedule/format";
import { localDay } from "@/domain/schedule/public-game";
import { localTime } from "@/domain/time/zoned";
import { requirePermission } from "@/lib/auth/permission";
import { activeLeagueId } from "@/lib/league/active";
import { setStatusAction } from "./actions";
import { ERRORS, NOTICES } from "./words";

export const metadata: Metadata = { title: "Game-day status" };

/**
 * An admin sets a game day's status (issue #383): On, Watching the weather
 * with a decision time, Delayed for chosen games, or Off for chosen games
 * or the whole day, with a short reason. Phone first, for the park.
 */
export default function StatusPage(
  props: PageProps<"/app/admin/seasons/[season]/status">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Status {...props} />
      </Suspense>
    </main>
  );
}

const FIELD =
  "min-h-11 rounded-md border border-border bg-surface px-2 py-1 text-text";

async function Status({
  params,
  searchParams,
}: PageProps<"/app/admin/seasons/[season]/status">) {
  const { season: slug } = await params;
  const query = await searchParams;
  const page = `/app/admin/seasons/${slug}/status`;
  await requirePermission("game_day.status", { next: page });
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  if (!season || season.status === "draft") notFound();
  const now = new Date();
  const today = localDay(now, season.timeZone);

  // Game days from today on, from the published schedule.
  const dates = [
    ...new Set(
      (await publishedSchedule(db, season.id))
        .filter(
          (g) =>
            g.startsAt !== null &&
            !g.slotCancelled &&
            (g.status === "scheduled" || g.status === "in_progress"),
        )
        .map((g) => localDay(g.startsAt as Date, season.timeZone))
        .filter((d) => d >= today),
    ),
  ].sort();
  const date =
    typeof query.date === "string" && dates.includes(query.date)
      ? query.date
      : (dates[0] ?? null);
  const error =
    typeof query.error === "string"
      ? ERRORS[query.error as keyof typeof ERRORS]
      : undefined;
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice] : undefined;

  const header = (
    <header className="flex flex-col gap-1">
      <p className="text-text-muted">{season.name}</p>
      <h1 className="text-h1">Game-day status</h1>
      <Link href="/app/admin/today" className="underline">
        Back to game day
      </Link>
    </header>
  );
  if (!date)
    return (
      <>
        {header}
        <p>No game days left on the published schedule.</p>
      </>
    );

  const [games, statuses] = await Promise.all([
    dayGames(db, season.id, date, season.timeZone),
    statusesFrom(db, season.id, date),
  ]);
  const status = statuses.get(date) ?? null;
  const tz = season.timeZone;
  const line = status ? dayLine(status, games.length, tz) : null;
  const overdue =
    status?.state === "watching" &&
    status.decideBy !== null &&
    status.decideBy.getTime() <= now.getTime();
  const firstGame = games[0];

  return (
    <>
      {header}
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg border border-success p-3">
          {notice}
          {query.handover === "1" && (
            <>
              {" "}
              To reschedule the games that are off, with makeups and league
              credit as usual,{" "}
              <Link
                href={`/app/admin/seasons/${slug}/rainout?date=${date}`}
                className="underline"
              >
                open the rain-out screen
              </Link>
              .
            </>
          )}
        </p>
      )}
      {overdue && (
        <p role="alert" className="rounded-lg border border-warning p-3">
          The decision time has passed and players are still waiting. Set the
          day to On, Delayed or Off.
        </p>
      )}

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          Game day
          <select name="date" defaultValue={date} className={FIELD}>
            {dates.map((d) => (
              <option key={d} value={d}>
                {shortDay(new Date(`${d}T12:00:00Z`), "UTC")}
              </option>
            ))}
          </select>
        </label>
        <SubmitButton className="btn btn-secondary">Show</SubmitButton>
      </form>

      <section aria-labelledby="now" className="flex flex-col gap-1">
        <h2 id="now" className="text-h3">
          Right now
        </h2>
        <p>{line ?? "Games are on."}</p>
        {status && (
          <p className="text-small text-text-muted">
            {updatedWords(status.setAt, tz)} on {shortDay(status.setAt, tz)}
          </p>
        )}
      </section>

      {games.length === 0 ? (
        <p>{ERRORS.no_games}</p>
      ) : (
        <form
          action={setStatusAction.bind(null, slug, date)}
          className="flex flex-col gap-5"
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="text-h3">Status</legend>
            {(
              [
                ["on", "On: games are on as scheduled"],
                ["watching", "Watching the weather, deciding by a set time"],
                ["delayed", "Delayed: chosen games start later"],
                ["off", "Off: chosen games, or all of them"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name="state"
                  value={value}
                  defaultChecked={(status?.state ?? "on") === value}
                  className="size-5"
                />
                {label}
              </label>
            ))}
          </fieldset>

          <label className="flex flex-col gap-1">
            Decide by (Watching)
            <input
              type="time"
              name="decideBy"
              defaultValue={
                status?.decideBy ? localTime(status.decideBy, tz) : ""
              }
              className={FIELD}
            />
            <span className="text-small text-text-muted">
              No later than the first game, at{" "}
              {firstGame ? kickoff(firstGame.startsAt, tz) : "its start"}.
              Admins get a reminder if it passes with no change.
            </span>
          </label>

          <label className="flex flex-col gap-1">
            Reason (optional)
            <input
              type="text"
              name="reason"
              maxLength={120}
              defaultValue={status?.reason ?? ""}
              placeholder="Field flooded"
              className={FIELD}
            />
          </label>

          <fieldset className="flex flex-col gap-3">
            <legend className="text-h3">Games (Delayed or Off)</legend>
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" name="all" className="size-5" />
              All games this day
            </label>
            {games.map((g) => {
              const current = gameStatus(status, g.id);
              const words = gameWords(current, tz);
              return (
                <div
                  key={g.id}
                  className="flex flex-col gap-2 rounded-card border border-border p-3"
                >
                  <label className="flex min-h-11 items-center gap-2">
                    <input
                      type="checkbox"
                      name={`game:${g.id}`}
                      defaultChecked={status?.games.has(g.id) ?? false}
                      className="size-5"
                    />
                    {kickoff(g.startsAt, tz)}: {g.teams}
                  </label>
                  {words && (
                    <p className="text-small text-text-muted">Now: {words}</p>
                  )}
                  <label className="flex flex-col gap-1">
                    <span>
                      New start, if delayed
                      <span className="sr-only">: {g.teams}</span>
                    </span>
                    <input
                      type="time"
                      name={`start:${g.id}`}
                      defaultValue={
                        current.kind === "delayed"
                          ? localTime(current.newStartsAt, tz)
                          : ""
                      }
                      className={FIELD}
                    />
                  </label>
                </div>
              );
            })}
          </fieldset>

          <SubmitButton className="btn btn-primary">
            Save the status
          </SubmitButton>
          <p className="text-text-muted">
            Delayed and Off tell the players in the games you tick at once, and
            Back on tells them when you undo it. Watching tells only players who
            asked for weather watches. Nothing is rescheduled here: games that
            are off go through the rain-out screen.
          </p>
        </form>
      )}
    </>
  );
}
