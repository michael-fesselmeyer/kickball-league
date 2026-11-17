/**
 * A wide table that scrolls sideways on a phone. The scrolling box is a
 * labelled region and a tab stop, so a keyboard user can reach it and scroll
 * it with the arrow keys even when the table has no links (axe
 * `scrollable-region-focusable`). Wrap every `overflow-x-auto` table in it.
 */
export function ScrollTable({
  label,
  className = "",
  children,
}: {
  /** What the table holds, read out when the region takes focus. */
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      // A scrolling region must be reachable by keyboard, even with no links.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      className={`relative max-w-full min-w-0 overflow-x-auto ${className}`}
    >
      {children}
    </div>
  );
}
