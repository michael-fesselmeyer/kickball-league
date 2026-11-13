"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * "Confirm with a passkey": a passkey sign-in on the page the person is on.
 * It is a new sign-in, so the session is fresh and the page, refreshed,
 * lets them continue.
 */
export function PasskeyConfirm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function confirm() {
    setPending(true);
    setMessage("");
    const { signInWithPasskey } = await import("@/lib/auth/passkey-client");
    const outcome = await signInWithPasskey();
    setPending(false);
    if (outcome.ok) router.refresh();
    else setMessage(outcome.message);
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={confirm}
        disabled={pending}
        className="btn self-start btn-primary disabled:opacity-60"
      >
        {pending ? "Waiting for your passkey…" : "Confirm with a passkey"}
      </button>
      <p role="alert" className="text-small text-danger empty:hidden">
        {message}
      </p>
    </div>
  );
}
