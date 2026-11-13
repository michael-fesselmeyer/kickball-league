"use client";

import { useFormStatus } from "react-dom";

/** Writing a draft takes several seconds, so the button says so meanwhile. */
export function WriteButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="btn self-start btn-secondary disabled:opacity-60"
    >
      {pending ? "Writing… (about 10 seconds)" : label}
    </button>
  );
}
