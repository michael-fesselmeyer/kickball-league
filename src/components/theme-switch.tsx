/** The switch's words, in the page's language (ADR 0094). */
export type ThemeLabels = {
  toLight: string;
  toDark: string;
};

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
 * A server component: the inline script in every page's <head>
 * (src/lib/theme-switch-script.ts) handles taps and keeps its label and
 * pressed state current, so it adds no client JavaScript. The visible box is
 * a snug 36px around the 20px icon; an invisible ::after keeps the tap
 * target at 44 × 44 without widening it.
 */
export function ThemeSwitch({ labels }: { labels: ThemeLabels }) {
  return (
    <button
      type="button"
      data-theme-switch=""
      data-to-light={labels.toLight}
      data-to-dark={labels.toDark}
      // Set from the theme in effect by the inline script, before React
      // hydrates; React must not undo it.
      aria-label={labels.toDark}
      aria-pressed={false}
      suppressHydrationWarning
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
