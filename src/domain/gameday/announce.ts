/**
 * What a screen reader is told about a game's clock and permit. The visible
 * lines count down every half minute, far too often to read out, so a hidden
 * status line carries a sentence that changes only when something a ref must
 * act on does: a phase change, or the 30, 15 and 5 minute marks. Pure, so
 * each threshold is tested.
 */
import type { Clock } from "./game-clock";
import type { Watch } from "./permit-end";

/** The minute marks that are read out, smallest first. */
export const ANNOUNCED_MARKS = [5, 15, 30] as const;

/** The smallest mark that `minutesLeft` is at or inside, or null above 30. */
export function markReached(minutesLeft: number): number | null {
  for (const mark of ANNOUNCED_MARKS) if (minutesLeft <= mark) return mark;
  return null;
}

const orLess = (mark: number) => `${mark} minutes or less left`;

/** The sentence for the game clock; empty while there is nothing to say. */
export function clockAnnouncement(clock: Clock): string {
  if (clock.level === "over") return "The game is over: no new inning starts.";
  const mark = markReached(clock.minutesLeft);
  if (clock.level === "last_inning")
    return clock.minutesLeft === 0
      ? "Last inning: time is up."
      : `Last inning: no new inning starts. ${orLess(mark ?? 30)}.`;
  return mark === null ? "" : `${orLess(mark)} on the game clock.`;
}

/** The sentence for the field's permit; empty while there is nothing to say. */
export function permitAnnouncement(watch: Watch): string {
  if (watch.level === "over") return "The permit has ended.";
  const mark = markReached(watch.minutesLeft);
  if (watch.level === "watch") {
    const why =
      watch.reason === "time_limit"
        ? "the time limit would run past the permit"
        : "at this pace the game would run past the permit";
    return mark === null
      ? `Heads up: ${why}.`
      : `Heads up: ${why}. ${orLess(mark)} on the permit.`;
  }
  return mark === null ? "" : `${orLess(mark)} in the permit.`;
}
