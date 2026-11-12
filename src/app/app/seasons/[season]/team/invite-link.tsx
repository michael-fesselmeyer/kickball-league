"use client";

import { useActionState, useState } from "react";
import type { InviteState } from "./actions";

type Props = {
  action: (previous: InviteState, form: FormData) => Promise<InviteState>;
  /** Whether a link is already out, so the button says it replaces it. */
  hasOpenLink: boolean;
};

export function InviteLink({ action, hasOpenLink }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const [copied, setCopied] = useState(false);
  const link = state.token
    ? `${window.location.origin}/app/join/${state.token}`
    : null;

  return (
    <div className="flex flex-col gap-3">
      {link ? (
        <>
          <label className="flex flex-col gap-1">
            Your team&apos;s link
            <input
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              className="rounded-md border border-border bg-surface px-2 py-1 text-small"
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                await navigator.clipboard.writeText(link);
                setCopied(true);
              }}
            >
              {copied ? "Copied!" : "Copy link"}
            </button>
            <a
              className="btn btn-secondary"
              href={`https://wa.me/?text=${encodeURIComponent(`Join our kickball team: ${link}`)}`}
              target="_blank"
              rel="noreferrer"
            >
              Share on WhatsApp
            </a>
          </div>
          <p className="text-small text-text-muted" role="status">
            Save it now: for safety, the league only keeps a fingerprint of it
            and cannot show it again. It works for 30 days.
          </p>
        </>
      ) : (
        <form action={formAction}>
          <button
            type="submit"
            disabled={pending}
            className="btn btn-primary disabled:opacity-60"
          >
            {pending
              ? "Making a link…"
              : hasOpenLink
                ? "Make a new link (the old one stops working)"
                : "Make an invite link"}
          </button>
        </form>
      )}
    </div>
  );
}
