"use client";

import { useActionState, useRef } from "react";
import { sendSignInLink, signInWithCode, type SignInState } from "./actions";

const initial: SignInState = { status: "idle" };

export function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(sendSignInLink, initial);
  const [codeState, verify, verifying] = useActionState(
    signInWithCode,
    initial,
  );
  const autofillStarted = useRef(false);

  /**
   * Offers saved passkeys in the email field's autofill. It starts when the
   * field is first focused, so the WebAuthn code never loads for people who
   * don't sign in.
   */
  async function offerPasskeys() {
    if (autofillStarted.current) return;
    autofillStarted.current = true;
    // An app's web view has no passkeys for this site (ADR 0075).
    if ("Capacitor" in window) return;
    const supported =
      typeof PublicKeyCredential !== "undefined" &&
      (await PublicKeyCredential.isConditionalMediationAvailable?.());
    if (!supported) return;
    const { passkeyAutofill } = await import("@/lib/auth/passkey-client");
    if (await passkeyAutofill()) window.location.assign(next);
  }

  if (state.status === "sent") {
    const codeError =
      codeState.status === "sent" ? codeState.codeError : undefined;
    return (
      <div className="flex flex-col gap-4">
        <p
          role="status"
          className="rounded-card border border-border bg-surface p-4 shadow-card dark:shadow-none"
        >
          <span className="mb-3 sticker">Check your email!</span>
          <br />
          We sent a sign-in link and a 6-digit code to{" "}
          <strong>{state.email}</strong>. Open the link, or enter the code here.
          Either works once and expires in 15 minutes.
        </p>
        <form action={verify} className="flex flex-col gap-3" noValidate>
          <input type="hidden" name="email" value={state.email} />
          <input type="hidden" name="next" value={next} />
          <label htmlFor="code" className="font-medium">
            6-digit code
          </label>
          <input
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={7}
            required
            aria-invalid={codeError ? true : undefined}
            aria-describedby={codeError ? "code-error" : undefined}
            className="min-h-11 rounded-input border-2 border-border-strong bg-surface px-3 py-2 font-mono text-h3 tracking-[0.3em] text-text"
          />
          {codeError && (
            <p id="code-error" role="alert" className="text-small text-danger">
              {codeError}
            </p>
          )}
          <button
            type="submit"
            disabled={verifying}
            className="btn btn-primary disabled:opacity-60"
          >
            {verifying ? "Checking…" : "Sign in"}
          </button>
        </form>
      </div>
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
