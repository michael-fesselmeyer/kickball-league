import {
  type CSSProperties,
  type ReactNode,
  useId,
  ViewTransition,
} from "react";

/*
 * Shared motion pieces (docs/design-system.md, section 6). They add no
 * JavaScript of their own: React's <ViewTransition> asks the browser's View
 * Transitions API to animate, and the styles live in motion.css. Browsers
 * without the API, and anyone who prefers reduced motion, get the same page
 * with no movement.
 */

/** The view-transition name a game card shares with its game page. */
export const gameMorph = (gameId: string) => `game-${gameId}`;

/** The name a team's badge shares with its team page header. */
export const teamMorph = (teamSeasonId: string) => `team-${teamSeasonId}`;

/**
 * An element that moves from one page to the next when both pages show it
 * under the same name, such as a game card growing into the game page's
 * scoreboard. Each name must be on one element of a page at a time. On its
 * own, without a partner on the other page, it does not animate.
 */
export function Morph({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  return (
    <ViewTransition name={name} share="morph" default="none">
      {children}
    </ViewTransition>
  );
}

/**
 * A number that flips like a scoreboard digit when it changes inside a
 * transition (a live score poll, a scorer's save). The old value rolls up
 * and out and the new one rolls in. Old and new share a name, so the
 * digit's box follows the table if the layout around it moves in the same
 * update. It never animates on first paint.
 */
export function Flip({ value }: { value: number | string }) {
  const name = `flip-${useId().replace(/[^\w-]/g, "")}`;
  return (
    <ViewTransition key={value} name={name} share="flip" default="none">
      <span className="inline-block">{value}</span>
    </ViewTransition>
  );
}

/**
 * The style for one item of a list whose items carry the `reveal` class, so
 * each rises a little after the one before it. Capped at ten items.
 */
export const revealOrder = (index: number) =>
  ({ "--reveal-i": Math.min(index, 9) }) as CSSProperties;
