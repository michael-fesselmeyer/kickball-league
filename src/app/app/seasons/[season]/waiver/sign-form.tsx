"use client";

import Link from "next/link";
import { useActionState } from "react";
import { AgeConfirmation } from "@/components/age-confirmation";
import type { SignState } from "./actions";

type Props = {
  action: (previous: SignState, form: FormData) => Promise<SignState>;
  shownSha256: string;
  fullName: string | null;
  minimumAge: number;
};

export function SignWaiverForm({
  action,
  shownSha256,
  fullName,
  minimumAge,
}: Props) {
  const [state, formAction, pending] = useActionState(action, {
    signedName: "",
  });
  if (!fullName)
    return (
      <p className="rounded-lg border border-warning p-3">
        Add your first and last name to{" "}
        <Link href="/app/profile" className="underline">
          your profile
        </Link>{" "}
        before signing.
      </p>
    );
  return (
    <form
      key={state.signedName}
      action={formAction}
      className="flex flex-col gap-4 rounded-lg border border-border p-4"
    >
      <input type="hidden" name="shownSha256" value={shownSha256} />
      {state.error && (
        <p role="alert" className="text-danger">
          {state.error}
        </p>
      )}
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          name="agree"
          value="yes"
          required
          className="mt-1"
        />
        <span>I have read the whole waiver and I agree to it.</span>
      </label>
      <label className="flex flex-col gap-1">
        Type your full name to sign
        <input
          name="signedName"
          defaultValue={state.signedName}
          autoComplete="name"
          required
          aria-describedby="signedName-hint"
          className="rounded-md border border-border bg-surface px-2 py-1 font-display text-h3"
        />
        <span id="signedName-hint" className="text-small text-text-muted">
          As on your profile: {fullName}.
        </span>
      </label>
      <AgeConfirmation minimumAge={minimumAge} />
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
