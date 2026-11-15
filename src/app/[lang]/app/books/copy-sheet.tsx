"use client";

import { useState } from "react";
import { copyText } from "@/components/share";

/**
 * Copies text to paste into NYC Parks: the request sheet for the
 * application, or the answers for its cancellation form.
 */
export function CopySheet({
  text,
  label = "Copy the sheet",
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        className="btn btn-primary"
        onClick={async () =>
          setCopied((await copyText(text)) ? "copied" : "failed")
        }
      >
        {label}
      </button>
      <span role="status" className="text-small text-text-muted">
        {copied === "copied"
          ? "Copied."
          : copied === "failed"
            ? "Couldn't copy. Select the text below instead."
            : ""}
      </span>
    </div>
  );
}
