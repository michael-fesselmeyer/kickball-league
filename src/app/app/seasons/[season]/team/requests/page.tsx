import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import {
  myRegistration,
  seasonForRegistration,
} from "@/db/queries/registration";
import { currentLeague } from "@/db/queries/seasons";
import { seasonGameTimes, teamRequests } from "@/db/queries/team-requests";
import { can } from "@/domain/authz/permissions";
import {
  MAX_REASON_LENGTH,
  MAX_REQUESTS_PER_TEAM,
  REQUEST_ERRORS,
  type RequestError,
  describeRequest,
  requestsOpen,
} from "@/domain/schedule/team-requests";
import { requirePermission } from "@/lib/auth/permission";
import { addTeamRequestAction, removeTeamRequestAction } from "./actions";
import { PageLoading } from "@/components/page-loading";

export const metadata: Metadata = { title: "Scheduling requests" };

const ERRORS: Record<string, string> = {
  ...REQUEST_ERRORS,
  closed:
    "Requests are closed for this season. Ask a league admin if something changed.",
  not_found: "That request was already removed.",
};

export default function TeamRequestsPage(
  props: PageProps<"/app/seasons/[season]/team/requests">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <TeamRequests {...props} />
      </Suspense>
    </main>
  );
}

async function TeamRequests({
  params,
  searchParams,
}: PageProps<"/app/seasons/[season]/team/requests">) {
  const { season: slug } = await params;
  const query = await searchParams;
  const subject = await requirePermission("registration.join", {
    next: `/app/seasons/${slug}/team/requests`,
  });
  const league = await currentLeague(db);
  const season = league
    ? await seasonForRegistration(db, league.id, slug)
    : null;
  if (!league || !season) notFound();
  const team = (await myRegistration(db, season.id, subject.userId))?.team;
  if (
    !team ||
    !can(subject, "conflicts.submit", { teamSeasonId: team.teamSeasonId })
  )
    notFound();

  const [requests, times] = await Promise.all([
    teamRequests(db, team.teamSeasonId),
    seasonGameTimes(db, season.id, league.timeZone),
  ]);
  const admin =
    subject.globalRole === "admin" || subject.globalRole === "owner";
  const open = admin || requestsOpen(season, new Date());
  const closes =
    season.registrationClosesAt ?? new Date(`${season.startsOn}T00:00:00Z`);
  const closesText = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: league.timeZone,
  }).format(closes);
  const timeLabel = (i: number) =>
    times.find((t) => t.timeIndex === i)?.label ?? `slot ${i + 1}`;
  const dateLabel = (d: string) =>
    new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${d}T00:00:00Z`));
  const error =
    typeof query.error === "string"
      ? (ERRORS[query.error as RequestError] ?? ERRORS[query.error])
      : undefined;
  const full = requests.length >= MAX_REQUESTS_PER_TEAM;

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link
          href={`/app/seasons/${slug}/team`}
          className="inline-flex min-h-11 items-center self-start underline"
        >
          {team.teamName}
        </Link>
        <h1 className="text-h1">Scheduling requests</h1>
        <p className="text-text-muted">
          Tell the league about dates your team can&apos;t play before the
          schedule is made. The schedule never puts you on a conflict date.
          Preferences are wishes: the schedule meets as many as it can while
          staying fair to every team.
        </p>
        <p>
          {open
            ? `Open until ${closesText}.`
            : `Closed on ${closesText}. A league admin can still make changes.`}
        </p>
      </header>

      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {(query.saved || query.removed) && (
        <p role="status" className="rounded-lg border border-success p-3">
          {query.saved ? "Request saved." : "Request removed."}
        </p>
      )}

      <section aria-labelledby="sent" className="flex flex-col gap-3">
        <h2 id="sent" className="text-h2">
          Your team&apos;s requests ({requests.length} of{" "}
          {MAX_REQUESTS_PER_TEAM})
        </h2>
        {requests.length === 0 ? (
          <p className="text-text-muted">
            Nothing yet. If every date works, you&apos;re all set.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {requests.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
              >
                <span>
                  {describeRequest(r, timeLabel, dateLabel)}
                  {r.reason && (
                    <span className="block text-text-muted">{r.reason}</span>
                  )}
                </span>
                {open && (
                  <form action={removeTeamRequestAction.bind(null, slug, r.id)}>
                    <button
                      type="submit"
                      className="inline-flex min-h-11 items-center underline"
                    >
                      Remove
                      <span className="sr-only">
                        : {describeRequest(r, timeLabel, dateLabel)}
                      </span>
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {open && !full && (
        <section aria-labelledby="add" className="flex flex-col gap-3">
          <h2 id="add" className="text-h2">
            Add a request
          </h2>
          <form
            action={addTeamRequestAction.bind(null, slug)}
            className="flex flex-col gap-4"
          >
            <fieldset className="flex flex-col gap-2">
              <legend className="font-semibold">What kind</legend>
              <label className="flex min-h-11 items-center gap-3">
                <input
                  className="size-5 accent-brand"
                  type="radio"
                  name="kind"
                  value="unavailable"
                  required
                />
                We can&apos;t play (a conflict)
              </label>
              <label className="flex min-h-11 items-center gap-3">
                <input
                  className="size-5 accent-brand"
                  type="radio"
                  name="kind"
                  value="prefer"
                />
                We&apos;d rather play
              </label>
              <label className="flex min-h-11 items-center gap-3">
                <input
                  className="size-5 accent-brand"
                  type="radio"
                  name="kind"
                  value="avoid"
                />
                We&apos;d rather not play
              </label>
            </fieldset>
            <label className="flex flex-col gap-1">
              Date (needed for a conflict)
              <input
                type="date"
                name="onDate"
                min={season.startsOn}
                max={season.endsOn}
                className="min-h-11 rounded-input border border-border-strong bg-surface px-3"
              />
            </label>
            <label className="flex flex-col gap-1">
              Game time
              <select
                name="timeIndex"
                className="min-h-11 rounded-input border border-border-strong bg-surface px-3"
              >
                <option value="">Any time that day</option>
                {times.map((t) => (
                  <option key={t.timeIndex} value={t.timeIndex}>
                    The {t.label} game
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Note for the admins (optional)
              <input
                type="text"
                name="reason"
                maxLength={MAX_REASON_LENGTH}
                className="min-h-11 rounded-input border border-border-strong bg-surface px-3"
              />
            </label>
            <button
              type="submit"
              className="min-h-11 self-start rounded-full border-2 border-text px-5 font-semibold"
            >
              Save request
            </button>
          </form>
        </section>
      )}
    </>
  );
}
