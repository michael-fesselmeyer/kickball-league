"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  dismissOutcome,
  type Outbox,
  readOutbox,
  sendWaiting,
} from "@/lib/pwa/score-outbox";

const EMPTY: Outbox = { entries: [], outcomes: [] };

/**
 * The score entries waiting on this phone and the server's answers to the
 * ones sent, kept current as the service worker sends them. Also asks the
 * worker to send when the page opens and when the signal comes back, which
 * is how entries go out on iPhones (no Background Sync there). With a game
 * id, only that game's entries.
 */
export function useOutbox(gameId?: string): Outbox {
  const router = useRouter();
  const [outbox, setOutbox] = useState<Outbox>(EMPTY);
  // Scores already saved when the page last looked; null before the first look.
  const saved = useRef<Set<string> | null>(null);

  const show = useCallback(
    (all: Outbox) => {
      const mine = <T extends { gameId: string }>(list: T[]) =>
        gameId ? list.filter((e) => e.gameId === gameId) : list;
      const next = {
        entries: mine(all.entries),
        outcomes: mine(all.outcomes),
      };
      setOutbox(next);
      // A score that reaches the server while the page is open changes what
      // it shows; one saved before the page loaded is in it already.
      const keys = next.outcomes
        .filter((o) => o.status === "saved")
        .map((o) => o.key);
      const before = saved.current;
      saved.current = new Set([...(before ?? []), ...keys]);
      if (before && keys.some((k) => !before.has(k))) router.refresh();
    },
    [gameId, router],
  );

  useEffect(() => {
    const container = navigator.serviceWorker;
    const onMessage = (event: MessageEvent) => {
      if (
        typeof event.data === "object" &&
        event.data !== null &&
        "type" in event.data &&
        event.data.type === "outbox-changed"
      )
        void readOutbox().then(show);
    };
    const onOnline = () => sendWaiting();
    container?.addEventListener("message", onMessage);
    window.addEventListener("online", onOnline);
    void readOutbox().then(show);
    sendWaiting();
    return () => {
      container?.removeEventListener("message", onMessage);
      window.removeEventListener("online", onOnline);
    };
  }, [show]);

  return outbox;
}

const TONE = {
  saved: "border-success",
  unchanged: "border-success",
  kept: "border-warning",
  refused: "border-danger",
} as const;

const HEADING = {
  saved: "Sent",
  unchanged: "Sent",
  kept: "Not used",
  refused: "Not saved",
} as const;

/**
 * What is waiting on this phone, and what happened to what was sent. Shows
 * nothing when the outbox is empty.
 */
export function OutboxStatus({ outbox }: { outbox: Outbox }) {
  const { entries, outcomes } = outbox;
  return (
    <div aria-live="polite" className="flex flex-col gap-3 empty:hidden">
      {entries.length > 0 && (
        <section
          aria-label="Waiting to send"
          className="flex flex-col gap-1 rounded-lg border-2 border-text p-3 shadow-sticker"
        >
          <p className="font-bold">
            Saved on this phone, will send when you&apos;re back online.
          </p>
          <ul className="text-small">
            {entries.map((e) => (
              <li key={e.key}>
                {e.summary}
                {e.problem && (
                  <span className="text-text-muted"> ({e.problem})</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {outcomes.map((o) => (
        <section
          key={o.key}
          aria-label={HEADING[o.status]}
          className={`flex flex-col gap-2 rounded-lg border p-3 ${TONE[o.status]}`}
        >
          <p>
            <span className="font-bold">{HEADING[o.status]}: </span>
            {o.summary}
          </p>
          <p className="text-small">{o.message}</p>
          <button
            type="button"
            className="btn self-start btn-secondary"
            onClick={() => dismissOutcome(o.key)}
          >
            OK
          </button>
        </section>
      ))}
    </div>
  );
}

/** The outbox for the home screen: every game's entries. */
export function AllOutboxStatus() {
  return <OutboxStatus outbox={useOutbox()} />;
}
