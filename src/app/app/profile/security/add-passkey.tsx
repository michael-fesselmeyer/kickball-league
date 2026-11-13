"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deviceName } from "@/domain/auth/device-name";

/**
 * "Add a passkey": the browser asks for Face ID, Touch ID or the device PIN
 * and saves the passkey, named after this device so the list says which is
 * which. The WebAuthn code loads on the tap.
 */
export function AddPasskey() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function add() {
    setPending(true);
    setMessage("");
    if (typeof PublicKeyCredential === "undefined") {
      setPending(false);
      setMessage("This browser can't save passkeys. Try your phone's browser.");
      return;
    }
    const { addPasskey } = await import("@/lib/auth/passkey-client");
    const outcome = await addPasskey(deviceName(navigator.userAgent));
    setPending(false);
    if (outcome.ok) router.push("/app/profile/security?done=added");
    else setMessage(outcome.message);
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={add}
        disabled={pending}
        className="btn self-start btn-primary disabled:opacity-60"
      >
        {pending ? "Waiting for your device…" : "Add a passkey"}
      </button>
      <p role="alert" className="text-small text-danger empty:hidden">
        {message}
      </p>
    </div>
  );
}
