"use client";

import { useState, useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * "Sign in with a passkey": Face ID, Touch ID or the device PIN. The WebAuthn
 * code loads on the first tap, so the sign-in page's first load stays within
 * its budget (docs/design-system.md, Performance budgets).
 */
export function PasskeySignIn({ next }: { next: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  // Passkeys for this site don't reach an app's web view yet (ADR 0077),
  // so the iOS and Android apps don't offer them.
  const inApp = useSyncExternalStore(
    noop,
    () => "Capacitor" in window,
    () => false,
  );

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

  if (inApp) return null;

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
