/**
 * When a game with no score triggers reminders (product-spec.md, "Scores"):
 * the referee 30 minutes after the slot ends, both captains after 2 hours,
 * and admins see it on their scores list throughout.
 */
export const REFEREE_AFTER_MS = 30 * 60_000;
export const CAPTAINS_AFTER_MS = 2 * 3_600_000;

/**
 * Games that ended longer ago than this are not chased by email; they stay
 * on the admin list. This keeps a first run, or a long outage, from
 * emailing about old games.
 */
export const LOOKBACK_MS = 2 * 86_400_000;

export type ReminderDue = { referee: boolean; captains: boolean };

/** Which reminders are due for a game whose slot ended at `endsAt`. */
export function scoreRemindersDue(endsAt: Date, now: Date): ReminderDue {
  const since = now.getTime() - endsAt.getTime();
  if (since > LOOKBACK_MS) return { referee: false, captains: false };
  return {
    referee: since >= REFEREE_AFTER_MS,
    captains: since >= CAPTAINS_AFTER_MS,
  };
}
