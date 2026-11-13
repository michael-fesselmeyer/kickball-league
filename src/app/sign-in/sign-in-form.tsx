"use client";

import { useActionState, useRef } from "react";
import { sendSignInLink, type SignInState } from "./actions";

const initial: SignInState = { status: "idle" };

export function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(sendSignInLink, initial);
  const autofillStarted = useRef(false);

  /**
   * Offers saved passkeys in the email field's autofill. It starts when the
   * field is first focused, so the WebAuthn code never loads for people who
   * don't sign in.
   */
  async function offerPasskeys() {
    if (autofillStarted.current) return;
    autofillStarted.current = true;
    const supported =
      typeof PublicKeyCredential !== "undefined" &&
      (await PublicKeyCredential.isConditionalMediationAvailable?.());
    if (!supported) return;
    const { passkeyAutofill } = await import("@/lib/auth/passkey-client");
    if (await passkeyAutofill()) window.location.assign(next);
  }

  if (state.status === "sent") {
    return (
      <p
        role="status"
        className="rounded-card border border-border bg-surface p-4 shadow-card dark:shadow-none"
      >
        <span className="mb-3 sticker">Link sent!</span>
        <br />
        Check your inbox. Your sign-in link is on its way to{" "}
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
        autoComplete="email webauthn"
        onFocus={offerPasskeys}
        inputMode="email"
        required
        defaultValue={state.status === "error" ? state.email : ""}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "email-error" : undefined}
        className="min-h-11 rounded-input border-2 border-border-strong bg-surface px-3 py-2 text-body text-text"
      />
      {error && (
        <p id="email-error" role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary disabled:opacity-60"
      >
        {pending ? "Sending…" : "Email me a link"}
      </button>
    </form>
  );
}
