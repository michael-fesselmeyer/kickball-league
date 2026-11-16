"use client";

import { useEffect, useSyncExternalStore } from "react";
import { readSavedTheme, THEME_STORAGE_KEY, type Theme } from "@/lib/theme";

/** The switch's words, in the page's language (ADR 0094). */
export type ThemeLabels = {
  toLight: string;
  toDark: string;
};

const listeners = new Set<() => void>();
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** The saved theme, else what the OS asks for. */
function read(): Theme {
  const saved = readSavedTheme();
  if (saved) return saved;
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener("change", notify);
  window.addEventListener("storage", notify);
  return () => {
    listeners.delete(notify);
    media.removeEventListener("change", notify);
    window.removeEventListener("storage", notify);
  };
}

function choose(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage blocked: the choice still applies for this page view.
  }
  listeners.forEach((notify) => notify());
}

/**
 * React rebuilds <html>'s attributes from the server render, which has no
 * data-theme, after a server action or a sign-in. Put the saved theme back
 * the moment that happens, before the browser paints.
 */
function keepSavedTheme() {
  const root = document.documentElement;
  const restore = () => {
    const saved = readSavedTheme();
    if (saved && root.dataset.theme !== saved) root.dataset.theme = saved;
  };
  restore();
  const observer = new MutationObserver(restore);
  observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

const iconProps = {
  viewBox: "0 0 24 24",
  width: 20,
  height: 20,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/**
 * One button that flips between light and dark, remembered on this device
 * (design-system.md §2). Both icons are rendered and CSS shows the one for
 * the theme in effect, so the server HTML is right before any script runs.
 * The visible box is a snug 36px around the 20px icon; an invisible ::after
 * keeps the tap target at 44 × 44 without widening it.
 */
export function ThemeSwitch({ labels }: { labels: ThemeLabels }) {
  const theme = useSyncExternalStore(subscribe, read, () => "light");
  useEffect(keepSavedTheme, []);
  const dark = theme === "dark";
  return (
    <button
      type="button"
      aria-label={dark ? labels.toLight : labels.toDark}
      aria-pressed={dark}
      onClick={() => choose(dark ? "light" : "dark")}
      className="relative inline-flex size-9 shrink-0 items-center justify-center rounded-input border border-border-strong p-0 leading-none text-text after:absolute after:-inset-1 after:content-['']"
    >
      <svg {...iconProps} className="hidden dark:block">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
      <svg {...iconProps} className="block dark:hidden">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    </button>
  );
}
