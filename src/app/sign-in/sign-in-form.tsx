"use client";

import { useActionState } from "react";
import { sendSignInLink, type SignInState } from "./actions";

const initial: SignInState = { status: "idle" };

export function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(sendSignInLink, initial);

  if (state.status === "sent") {
    return (
      <p
        role="status"
        className="rounded-card border border-border bg-surface p-4 shadow-card dark:shadow-none"
      >
        Check your inbox. We sent a sign-in link to{" "}
        <strong>{state.email}</strong>. It works once and expires in 15 minutes.
      </p>
    );
  }

  const error = state.status === "error" ? state.message : undefined;
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="next" value={next} />
      <label htmlFor="email" className="font-medium">
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        defaultValue={state.status === "error" ? state.email : ""}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "email-error" : undefined}
        className="min-h-11 rounded-input border border-border-strong bg-surface px-3 py-2 text-body text-text"
      />
      {error && (
        <p id="email-error" role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 rounded-input bg-brand px-4 py-2 font-medium text-on-brand disabled:opacity-60"
      >
        {pending ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
