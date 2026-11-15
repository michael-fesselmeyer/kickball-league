import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/db/client";
import { privateEventQueue, type QueueRow } from "@/db/queries/private-events";
import { currentLeague } from "@/db/queries/seasons";
import { money } from "@/domain/books/ledger";
import type { AcceptProblem } from "@/domain/private-events/request";
import { requirePermission } from "@/lib/auth/permission";
import { acceptPrivateEventAction, declinePrivateEventAction } from "./actions";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = {
  title: "Private leagues and tournaments",
};

const PAGE = "/app/admin/private-events";

const ERRORS: Record<AcceptProblem | "not_found" | "not_open", string> = {
  no_name: "Give the private season a name of up to 80 characters.",
  bad_dates: "Check the dates: the last day can't be before the first.",
  bad_payer: "Choose who pays.",
  bad_amount: "Enter the amount in dollars, such as 600 or 45.50.",
  bad_games_per_day: "Choose one or two games a team per game day.",
  not_found: "That request is gone.",
  not_open: "That request was already answered.",
};

const field = "min-h-11 rounded-md border border-border bg-surface px-2 py-1";

export default function AdminPrivateEventsPage(
  props: PageProps<"/app/admin/private-events">,
) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <Suspense fallback={<div className="min-h-svh" aria-busy="true" />}>
        <Queue {...props} />
      </Suspense>
    </main>
  );
}

const who = (r: QueueRow) =>
  [r.firstName, r.lastName].filter(Boolean).join(" ") || r.organizerName;

async function Queue({ searchParams }: PageProps<"/app/admin/private-events">) {
  await requirePermission("private_event.manage", { next: PAGE });
  const query = await searchParams;
  const league = await currentLeague(db);
  const rows = league ? await privateEventQueue(db, league.id) : [];
  const error =
    typeof query.error === "string" && query.error in ERRORS
      ? ERRORS[query.error as keyof typeof ERRORS]
      : null;
  const open = rows.filter((r) => r.status === "requested");
  const answered = rows.filter((r) => r.status !== "requested");

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link
          href="/app/admin"
          className="inline-flex min-h-11 items-center self-start underline"
        >
          League admin
        </Link>
        <h1 className="text-h1">Private leagues and tournaments</h1>
        <p className="text-text-muted">
          Requests from the public{" "}
          <Link href="/private-events" className="underline">
            booking page
          </Link>
          . Accepting one sets up an invite-only private season: it never shows
          on public pages, standings, records or awards. Then add its field time
          and build its schedule or bracket as for any season.
        </p>
      </header>
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {query.done === "declined" && (
        <p role="status" className="rounded-lg border border-success p-3">
          Declined. The organizer has been told.
        </p>
      )}

      <section aria-labelledby="open" className="flex flex-col gap-4">
        <h2 id="open" className="text-h2">
          Waiting ({open.length})
        </h2>
        {open.length === 0 && (
          <p className="text-text-muted">No requests waiting.</p>
        )}
        {open.map((r) => (
          <article
            key={r.id}
            id={`request-${r.id}`}
            aria-label={r.organization}
            className="flex flex-col gap-3 rounded-lg border border-border p-4"
          >
            <h3 className="text-h3">{r.organization}</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-text-muted">What</dt>
              <dd>
                {r.kind === "tournament" ? "Tournament" : "Private league"},{" "}
                {r.teams} teams
              </dd>
              <dt className="text-text-muted">When</dt>
              <dd>{r.preferredDates}</dd>
              <dt className="text-text-muted">Contact</dt>
              <dd>
                {who(r)},{" "}
                <a href={`mailto:${r.organizerEmail}`} className="underline">
                  {r.organizerEmail}
                </a>
              </dd>
              {r.note && (
                <>
                  <dt className="text-text-muted">Note</dt>
                  <dd className="whitespace-pre-line">{r.note}</dd>
                </>
              )}
            </dl>
            <details>
              <summary className="btn cursor-pointer btn-primary">
                Accept<span className="sr-only"> {r.organization}</span>
              </summary>
              <form
                action={acceptPrivateEventAction.bind(null, r.id)}
                className="mt-3 flex flex-col gap-3"
              >
                <label className="flex flex-col gap-1">
                  <span className="text-small">Private season name</span>
                  <input
                    name="name"
                    required
                    maxLength={80}
                    defaultValue={`${r.organization} ${r.kind === "tournament" ? "Tournament" : "League"}`}
                    className={field}
                  />
                </label>
                <div className="flex flex-wrap gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-small">First day</span>
                    <input
                      type="date"
                      name="startsOn"
                      required
                      className={field}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-small">Last day (optional)</span>
                    <input type="date" name="endsOn" className={field} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-small">Games a team per day</span>
                    <select
                      name="gamesPerTeamPerDay"
                      defaultValue={r.kind === "tournament" ? "2" : "1"}
                      className={field}
                    >
                      <option value="1">One</option>
                      <option value="2">Two</option>
                    </select>
                  </label>
                </div>
                <fieldset className="flex flex-col gap-1">
                  <legend className="text-small">Who pays</legend>
                  <label className="flex min-h-11 items-center gap-2">
                    <input
                      type="radio"
                      name="payer"
                      value="organization"
                      defaultChecked
                      className="size-5"
                    />
                    The organization, once for every team
                  </label>
                  <label className="flex min-h-11 items-center gap-2">
                    <input
                      type="radio"
                      name="payer"
                      value="players"
                      className="size-5"
                    />
                    Each player, as in a league season
                  </label>
                </fieldset>
                <label className="flex flex-col gap-1 self-start">
                  <span className="text-small">
                    Amount in dollars (the organization&apos;s total, or each
                    player&apos;s fee)
                  </span>
                  <input
                    name="amount"
                    required
                    inputMode="decimal"
                    autoComplete="off"
                    className={`${field} w-40`}
                  />
                </label>
                <SubmitButton className="btn self-start btn-primary">
                  Set up the private season
                </SubmitButton>
              </form>
            </details>
            <details>
              <summary className="btn cursor-pointer btn-secondary">
                Decline<span className="sr-only"> {r.organization}</span>
              </summary>
              <form
                action={declinePrivateEventAction.bind(null, r.id)}
                className="mt-3 flex flex-col gap-3"
              >
                <label className="flex flex-col gap-1">
                  <span className="text-small">
                    Reason for the organizer (optional)
                  </span>
                  <textarea
                    name="reason"
                    rows={3}
                    maxLength={500}
                    className={`${field} min-h-24`}
                  />
                </label>
                <SubmitButton className="btn self-start btn-secondary">
                  Decline the request
                </SubmitButton>
              </form>
            </details>
          </article>
        ))}
      </section>

      <section aria-labelledby="answered" className="flex flex-col gap-3">
        <h2 id="answered" className="text-h2">
          Answered
        </h2>
        {answered.length === 0 ? (
          <p className="text-text-muted">Nothing answered yet.</p>
        ) : (
          <ul className="flex flex-col">
            {answered.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2"
              >
                <span>
                  {r.organization}
                  <span className="block text-small text-text-muted">
                    {r.status === "accepted"
                      ? `Set up${r.payer === "organization" && r.priceCents !== null ? `, ${money(r.priceCents)} ${r.paidAt ? "paid" : "to pay"}` : ""}`
                      : "Declined"}
                  </span>
                </span>
                {r.status === "accepted" && r.seasonSlug && (
                  <Link
                    href={`/app/private-events/${r.seasonSlug}`}
                    className="btn btn-secondary"
                  >
                    Open<span className="sr-only"> {r.seasonName}</span>
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
