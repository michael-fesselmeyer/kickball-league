"use client";

import { useSyncExternalStore } from "react";
import {
  DISMISSED_KEY,
  INSTALLABLE_EVENT,
  type InstallOffer,
  installOffer,
  isIos,
  VISITS_KEY,
} from "@/lib/pwa/install";

/** The browser's deferred install prompt (Chromium only). */
type DeferredPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

declare global {
  interface Window {
    /** Held by the registration script in the root layout. */
    __kbInstallPrompt?: DeferredPrompt | undefined;
  }
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void) {
  listeners.add(listener);
  const events = [INSTALLABLE_EVENT, "appinstalled", "storage"];
  events.forEach((name) => window.addEventListener(name, listener));
  return () => {
    listeners.delete(listener);
    events.forEach((name) => window.removeEventListener(name, listener));
  };
}

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function currentOffer(): InstallOffer {
  return installOffer({
    visits: Number(stored(VISITS_KEY)) || 0,
    dismissed: stored(DISMISSED_KEY) !== null,
    standalone:
      window.matchMedia("(display-mode: standalone)").matches ||
      ("standalone" in navigator && navigator.standalone === true),
    canPrompt: window.__kbInstallPrompt !== undefined,
    ios: isIos(navigator.userAgent, navigator.maxTouchPoints),
  });
}

function remember() {
  try {
    localStorage.setItem(DISMISSED_KEY, new Date().toISOString());
  } catch {
    // Private browsing: the offer comes back next session, which is fine.
  }
  notify();
}

async function install() {
  const deferred = window.__kbInstallPrompt;
  if (!deferred) return;
  window.__kbInstallPrompt = undefined;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  if (outcome === "dismissed") remember();
  else notify();
}

/**
 * Offers captains, refs and admins the installed app. The home screen renders
 * it only for them; this decides, on the device, whether now is the time.
 * It floats over the bottom of the screen, so appearing after load shifts
 * nothing.
 */
export function InstallPrompt() {
  const offer = useSyncExternalStore(subscribe, currentOffer, () => null);
  if (offer === null) return null;

  return (
    <aside
      aria-labelledby="install-title"
      className="fixed inset-x-4 bottom-4 z-10 mx-auto flex max-w-sm flex-col gap-3 rounded-card border-2 border-text bg-surface p-4 shadow-sticker"
    >
      <h2 id="install-title" className="text-h3">
        Put the league on your home screen
      </h2>
      <p className="text-text-muted">
        It opens like an app at the field and keeps your next game on your phone
        for when there&apos;s no signal.
      </p>
      {offer === "ios" && (
        <p>
          In Safari, tap <strong>Share</strong>, then{" "}
          <strong>Add to Home Screen</strong>.
        </p>
      )}
      <div className="flex gap-2">
        {offer === "prompt" && (
          <button type="button" className="btn btn-primary" onClick={install}>
            Install
          </button>
        )}
        <button type="button" className="btn btn-secondary" onClick={remember}>
          {offer === "ios" ? "Got it" : "Not now"}
        </button>
      </div>
    </aside>
  );
}
