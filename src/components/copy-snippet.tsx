"use client";

import { useId, useState } from "react";

/**
 * A read-only snippet with a Copy button. The text is in the server HTML,
 * so it can be selected and copied by hand before (or without) this script.
 */
export function CopySnippet({ label, text }: { label: string; text: string }) {
  const id = useId();
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="font-bold">
        {label}
      </label>
      <textarea
        id={id}
        readOnly
        rows={3}
        value={text}
        onFocus={(e) => e.currentTarget.select()}
        className="min-h-11 rounded-input border border-border-strong bg-surface px-3 py-2 font-mono text-small"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied("yes");
            } catch {
              setCopied("no");
            }
          }}
        >
          Copy
        </button>
        <p role="status" className="text-small text-text-muted">
          {copied === "yes"
            ? "Copied."
            : copied === "no"
              ? "Couldn't copy. Select the text and copy it instead."
              : ""}
        </p>
      </div>
    </div>
  );
}
