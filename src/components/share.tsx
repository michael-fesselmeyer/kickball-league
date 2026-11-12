"use client";

import { useId, useState, useSyncExternalStore } from "react";
import { whatsappHref } from "@/domain/share/share-text";

/**
 * Sharing into the league's WhatsApp chats (docs/product-spec.md): one tap
 * opens WhatsApp with the message filled in; the second button uses the
 * phone's share sheet where there is one, else copies the message.
 */

/** Copies text, with an older fallback for browsers without the Clipboard API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}

const noSubscribe = () => () => {};
const hasShareSheet = () => typeof navigator.share === "function";

type Copied = "idle" | "copied" | "failed";

/** When copying fails, the message is shown so it can be selected by hand. */
function ManualCopy({ text, state }: { text: string; state: Copied }) {
  const id = useId();
  if (state !== "failed") return null;
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-small font-bold">
      Copying didn&apos;t work here. Select the message and copy it:
      <textarea
        id={id}
        readOnly
        rows={5}
        value={text}
        onFocus={(e) => e.currentTarget.select()}
        className="rounded-input border border-border-strong bg-bg p-2 font-normal"
      />
    </label>
  );
}

function WhatsAppIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    >
      <path d="M4 20l1.3-3.9A8 8 0 1 1 8 19.1L4 20z" />
    </svg>
  );
}

export function ShareButtons({
  text,
  title,
}: {
  /** The whole message, link included. */
  text: string;
  title: string;
}) {
  // False on the server and during hydration, so the markup matches.
  const shareSheet = useSyncExternalStore(
    noSubscribe,
    hasShareSheet,
    () => false,
  );
  const [copied, setCopied] = useState<Copied>("idle");

  async function more() {
    if (shareSheet) {
      try {
        await navigator.share({ title, text });
        return;
      } catch (error) {
        // Closing the sheet is a choice, not a failure.
        if (error instanceof Error && error.name === "AbortError") return;
      }
    }
    setCopied((await copyText(text)) ? "copied" : "failed");
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <a
          href={whatsappHref(text)}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-primary"
        >
          <WhatsAppIcon />
          Share on WhatsApp
          <span className="sr-only"> (opens WhatsApp)</span>
        </a>
        <button type="button" onClick={more} className="btn btn-secondary">
          {shareSheet ? "More ways to share" : "Copy the message"}
        </button>
      </div>
      <p role="status" className="text-small text-text-muted">
        {copied === "copied" ? "Copied. Paste it into any chat." : ""}
      </p>
      <ManualCopy text={text} state={copied} />
    </div>
  );
}

/** A button that copies a ready-made message for a WhatsApp group chat. */
export function CopyForWhatsApp({
  text,
  label = "Copy for WhatsApp",
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState<Copied>("idle");
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={async () =>
            setCopied((await copyText(text)) ? "copied" : "failed")
          }
          className="btn self-start btn-secondary"
        >
          {label}
        </button>
        <span role="status" className="text-small text-text-muted">
          {copied === "copied" ? "Copied. Paste it into the group chat." : ""}
        </span>
      </div>
      <ManualCopy text={text} state={copied} />
    </div>
  );
}
