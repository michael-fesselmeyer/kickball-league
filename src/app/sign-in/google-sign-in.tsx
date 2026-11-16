"use client";

import { type FormEvent, useState } from "react";
import { SubmitButton } from "@/components/submit-button";

/**
 * "Continue with Google". On the web it is a plain form posting to a
 * Server Action, so it works before JavaScript loads. Inside the iOS and
 * Android apps, where Google refuses an embedded web view, it opens the
 * system browser sheet instead and brings the sign-in back to the app
 * (ADR 0075); that code loads only on the tap.
 */
export function GoogleSignIn({
  action,
  next,
  appScheme,
  error,
}: {
  action: (form: FormData) => Promise<void>;
  next: string;
  appScheme: string;
  error?: string | undefined;
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | undefined>(error);

  async function inApp() {
    setPending(true);
    setMessage(undefined);
    const { shellPlugins, signInWithGoogleInApp } =
      await import("@/lib/mobile/app-sign-in-client");
    const plugins = shellPlugins(window);
    const outcome = plugins
      ? await signInWithGoogleInApp({
          plugins,
          origin: window.location.origin,
          scheme: appScheme,
        })
      : "failed";
    if (outcome === "signed-in") {
      window.location.assign(next);
      return;
    }
    setPending(false);
    if (outcome === "failed")
      setMessage(
        "Google sign-in didn't come through. Try again, or use the code from an email.",
      );
  }

  return (
    <form
      action={action}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        // Only the app takes over; a browser posts the form as usual.
        if (!("Capacitor" in window)) return;
        event.preventDefault();
        if (!pending) void inApp();
      }}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="next" value={next} />
      <SubmitButton className="btn btn-secondary" disabled={pending}>
        {pending ? "Finish signing in with Google…" : "Continue with Google"}
      </SubmitButton>
      {message && (
        <p role="alert" className="text-small text-danger">
          {message}
        </p>
      )}
    </form>
  );
}
