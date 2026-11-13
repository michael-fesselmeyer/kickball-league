"use client";

import { useState } from "react";

/**
 * "Sign in with a passkey": Face ID, Touch ID or the device PIN. The WebAuthn
 * code loads on the first tap, so the sign-in page's first load stays within
 * its budget (docs/design-system.md, Performance budgets).
 */
export function PasskeySignIn({ next }: { next: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function signIn() {
    setPending(true);
    setMessage("");
    const { signInWithPasskey } = await import("@/lib/auth/passkey-client");
    const outcome = await signInWithPasskey();
    if (outcome.ok) {
      window.location.assign(next);
      return;
    }
    setPending(false);
    setMessage(outcome.message);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-small text-text-muted">or</p>
      <button
        type="button"
        onClick={signIn}
        disabled={pending}
        className="btn btn-secondary disabled:opacity-60"
      >
        {pending ? "Waiting for your passkey…" : "Sign in with a passkey"}
      </button>
      <p role="alert" className="text-small text-danger empty:hidden">
        {message}
      </p>
    </div>
  );
}
