"use client";

import { useState } from "react";
import { copyText } from "@/components/share";

/** Copies the request sheet, to paste into the NYC Parks application. */
export function CopySheet({ text }: { text: string }) {
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
        Copy the sheet
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
