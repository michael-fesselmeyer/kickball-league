"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import {
  type AlertCardState,
  answerAlertCardAction,
} from "@/app/app/alert-card-actions";
import type { CardCopy } from "@/domain/notifications/alert-cards";
import { browserPushGlobals, subscribeDevice } from "@/lib/pwa/push-client";

const DONE: Record<Exclude<AlertCardState["status"], "idle">, string> = {
  yes: "You're set. Change it any time in your settings.",
  email_instead:
    "This browser can't show notifications here, so we'll email you instead. You can change it any time in your settings.",
  no: "No problem. We won't ask again for a while.",
  error: "That didn't save. Try again from your settings.",
};

/**
 * One alert offer at the moment it helps (issue #529): the question, a
 * sample of the message, "Yes" and "No thanks". Only "Yes" on a push card
 * asks the browser for permission. The answer replaces the card with one
 * line, in the same box, so nothing below it jumps.
 */
export function AlertCardView({
  copy,
  publicKey,
}: {
  copy: CardCopy;
  publicKey: string | null;
}) {
  const [asking, setAsking] = useState(false);
  const [state, answer, pending] = useActionState<AlertCardState, FormData>(
    answerAlertCardAction,
    {
      status: "idle",
    },
  );

  const yes = async () => {
    const form = new FormData();
    form.set("card", copy.card);
    form.set("answer", "yes");
    if (copy.channel === "push") {
      setAsking(true);
      const subscribed = publicKey
        ? await subscribeDevice(browserPushGlobals(), publicKey)
        : ({ ok: false } as const);
      setAsking(false);
      if (subscribed.ok) form.set("subscription", subscribed.json);
      else form.set("push_failed", "1");
    }
    startTransition(() => answer(form));
  };

  const headingId = `alert-card-${copy.card}`;
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-card border-2 border-text bg-surface p-4"
    >
      {state.status === "idle" ? (
        <>
          <h2 id={headingId} className="text-h3">
            {copy.question}
          </h2>
          <p className="text-small">{copy.detail}</p>
          <figure className="flex flex-col gap-1 rounded-card bg-surface-2 p-3">
            <figcaption className="text-micro text-text-muted">
              It looks like this
            </figcaption>
            <p className="text-small font-bold">{copy.sample.title}</p>
            <p className="text-small">{copy.sample.body}</p>
          </figure>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending || asking}
              onClick={() => void yes()}
            >
              {copy.yes}
            </button>
            <form action={answer}>
              <input type="hidden" name="card" value={copy.card} />
              <input type="hidden" name="answer" value="no" />
              <button
                type="submit"
                className="btn btn-secondary"
                disabled={pending || asking}
              >
                No thanks
              </button>
            </form>
          </div>
        </>
      ) : (
        <>
          <h2 id={headingId} className="text-h3">
            {state.status === "no" ? "Got it" : "Alerts"}
          </h2>
          <p role="status" className="text-small">
            {DONE[state.status]}{" "}
            <Link
              href="/app/profile#notifications"
              className="inline-flex min-h-11 items-center underline"
            >
              Alert settings
            </Link>
          </p>
        </>
      )}
    </section>
  );
}
