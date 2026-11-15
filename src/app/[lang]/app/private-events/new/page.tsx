import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  MAX_TEAMS,
  MIN_TEAMS,
  type RequestProblem,
} from "@/domain/private-events/request";
import { requirePermission } from "@/lib/auth/permission";
import { requestPrivateEventAction } from "../actions";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = {
  title: "Request a private league or tournament",
};

const PAGE = "/app/private-events/new";

const ERRORS: Record<RequestProblem | "too_many", string> = {
  bad_kind: "Choose a tournament or a private league.",
  no_organization: "Enter who it's for: a company, club or group name.",
  bad_teams: `Enter between ${MIN_TEAMS} and ${MAX_TEAMS} teams.`,
  no_dates: "Tell us roughly when, such as a Saturday in May.",
  too_long: "That's longer than we can take. Shorten the note or the dates.",
  too_many:
    "You've sent three requests today. We'll get back to you on those first.",
};

const field = "min-h-11 rounded-md border border-border bg-surface px-3 py-2";

export default function NewPrivateEventPage(
  props: PageProps<"/[lang]/app/private-events/new">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <Suspense fallback={<div className="min-h-svh" aria-busy="true" />}>
        <RequestForm {...props} />
      </Suspense>
    </main>
  );
}

async function RequestForm({
  searchParams,
}: PageProps<"/[lang]/app/private-events/new">) {
  await requirePermission("private_event.request", { next: PAGE });
  const query = await searchParams;
  const error =
    typeof query.error === "string" && query.error in ERRORS
      ? ERRORS[query.error as keyof typeof ERRORS]
      : null;
  return (
    <>
      <header className="flex flex-col gap-2">
        <Link
          href="/private-events"
          className="inline-flex min-h-11 items-center self-start underline"
        >
          Private leagues and tournaments
        </Link>
        <h1 className="text-h1">Request a booking</h1>
        <p className="text-text-muted">
          Tell us what you have in mind. An admin will reply by email, usually
          within a week; there&apos;s nothing to pay until you agree the
          details.
        </p>
      </header>
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      <form action={requestPrivateEventAction} className="flex flex-col gap-5">
        <fieldset className="flex flex-col gap-2">
          <legend className="font-semibold">What would you like?</legend>
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="radio"
              name="kind"
              value="tournament"
              defaultChecked
              className="size-5"
            />
            A one-day tournament
          </label>
          <label className="flex min-h-11 items-center gap-3">
            <input type="radio" name="kind" value="league" className="size-5" />
            A private league over several weeks
          </label>
        </fieldset>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Who it&apos;s for</span>
          <span className="text-small text-text-muted">
            A company, club or group name
          </span>
          <input
            name="organization"
            required
            maxLength={120}
            autoComplete="organization"
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1 self-start">
          <span className="font-semibold">How many teams</span>
          <input
            type="number"
            name="teams"
            required
            min={MIN_TEAMS}
            max={MAX_TEAMS}
            defaultValue={4}
            inputMode="numeric"
            className={`${field} w-28`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">When</span>
          <span className="text-small text-text-muted">
            A few dates or days that work, such as &ldquo;a Saturday in
            May&rdquo; or &ldquo;Thursday evenings in June&rdquo;
          </span>
          <input
            name="preferredDates"
            required
            maxLength={300}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Anything else (optional)</span>
          <textarea
            name="note"
            rows={4}
            maxLength={2000}
            className={`${field} min-h-28`}
          />
        </label>
        <p className="text-small text-text-muted">
          We&apos;ll reply to the email address you signed in with.
        </p>
        <SubmitButton className="btn self-start btn-primary">
          Send the request
        </SubmitButton>
      </form>
    </>
  );
}
