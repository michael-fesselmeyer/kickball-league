"use client";

import { useActionState } from "react";
import { type GuestSignState, signGuestWaiverAction } from "../actions";

const initial: GuestSignState = { status: "idle" };
const input =
  "min-h-11 rounded-input border-2 border-border-strong bg-surface px-3 py-2 text-body text-text";

/** One player's signature: their full name and a tick, nothing else. */
export function GuestSignForm({
  token,
  shownSha256,
}: {
  token: string;
  shownSha256: string;
}) {
  const [state, action, pending] = useActionState(
    signGuestWaiverAction.bind(null, token, shownSha256),
    initial,
  );
  if (state.status === "signed")
    return (
      <p
        role="status"
        className="rounded-card border border-border bg-surface p-4 shadow-card dark:shadow-none"
      >
        <span className="mb-3 sticker">Signed!</span>
        <br />
        Thanks, {state.name}. You&apos;re all set. Pass this link to the next
        player on your team.
      </p>
    );
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <label className="flex flex-col gap-1 font-medium">
        Your full name
        <input
          name="signedName"
          required
          maxLength={80}
          autoComplete="name"
          className={input}
        />
      </label>
      <label className="flex min-h-11 items-start gap-2">
        <input
          type="checkbox"
          name="agree"
          required
          className="mt-1 size-5 accent-brand"
        />
        I have read the waiver above and agree to it.
      </label>
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
        {pending ? "Signing…" : "Sign the waiver"}
      </button>
    </form>
  );
}
