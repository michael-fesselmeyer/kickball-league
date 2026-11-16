"use client";

import { useActionState } from "react";
import { CopySnippet } from "@/components/copy-snippet";
import {
  type GuestSignupState,
  signUpGuestTeam,
} from "@/app/[lang]/guest/actions";
import { MAX_ROSTER, MIN_ROSTER } from "@/domain/tournaments/roster-limits";

const initial: GuestSignupState = { status: "idle" };
const input =
  "min-h-11 rounded-input border-2 border-border-strong bg-surface px-3 py-2 text-body text-text";

/**
 * A guest captain's sign-up. On success it shows the team's waiver link to
 * share; the page itself stays static HTML and this form is its only
 * client code.
 */
export function GuestSignupForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(
    signUpGuestTeam.bind(null, slug),
    initial,
  );
  if (state.status === "done")
    return (
      <div
        role="status"
        className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 shadow-card dark:shadow-none"
      >
        <p>
          <span className="sticker">You&apos;re in!</span>
        </p>
        <p>
          {state.teamName} is entered. Send this link to every player on your
          team: each one signs the waiver on their own phone, no account needed.
          Save it now; we can&apos;t show it again, though the league&apos;s
          admins can send it to you.
        </p>
        <CopySnippet
          label="Waiver link for your team"
          text={`${typeof window === "undefined" ? "" : window.location.origin}/guest/${state.token}`}
        />
      </div>
    );
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <label className="flex flex-col gap-1 font-medium">
        Team name
        <input name="teamName" required maxLength={60} className={input} />
      </label>
      <label className="flex flex-col gap-1 font-medium">
        Captain&apos;s name
        <input
          name="captainName"
          required
          maxLength={80}
          autoComplete="name"
          className={input}
        />
      </label>
      <label className="flex flex-col gap-1 font-medium">
        Captain&apos;s email
        <span className="font-normal text-text-muted">
          Only the league&apos;s admins see it. We delete it after the event.
        </span>
        <input
          type="email"
          name="captainEmail"
          required
          maxLength={254}
          autoComplete="email"
          className={input}
        />
      </label>
      <label className="flex flex-col gap-1 font-medium">
        How many players?
        <input
          name="rosterSize"
          type="number"
          inputMode="numeric"
          min={MIN_ROSTER}
          max={MAX_ROSTER}
          required
          className={input}
        />
      </label>
      {/* Honeypot: hidden from people and from assistive tech, tempting to bots. */}
      <div aria-hidden="true" className="sr-only">
        <label>
          Leave this empty
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {state.status === "error" && (
        <p role="alert" className="text-small text-danger">
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="btn self-start btn-primary disabled:opacity-60"
      >
        {pending ? "Entering…" : "Enter our team"}
      </button>
    </form>
  );
}
