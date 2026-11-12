"use client";

import { useSyncExternalStore } from "react";
import {
  isThemeChoice,
  THEME_STORAGE_KEY,
  type ThemeChoice,
} from "@/lib/theme";

const choices: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const listeners = new Set<() => void>();

function read(): ThemeChoice {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

function choose(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
  try {
    if (choice === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Storage blocked: the choice still applies for this page view.
  }
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

/** Auto, Light or Dark, remembered on this device (design-system.md §2). */
export function ThemeSwitch() {
  const current = useSyncExternalStore(
    subscribe,
    read,
    () => "system" as const,
  );
  return (
    <div
      role="group"
      aria-label="Color theme"
      className="flex rounded-input border border-border-strong p-0.5"
    >
      {choices.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          aria-pressed={current === value}
          onClick={() => choose(value)}
          className="min-h-11 min-w-11 rounded-[4px] px-2 text-small font-medium text-text-muted aria-pressed:bg-brand aria-pressed:text-on-brand sm:px-3"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
