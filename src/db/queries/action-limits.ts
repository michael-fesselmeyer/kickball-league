import type { Db } from "./schedule";
import { consumeRateLimit } from "./rate-limit";

/**
 * Limits on actions that need an account but still cost something each
 * time: a Stripe Checkout session, a team link, a score report, a waitlist
 * change (docs/architecture.md, section 13, Rate limits). Counted per person
 * (or per team for team links) in the same `rate_limit` table as sign-ins,
 * so they hold across server instances. A refused request is still counted,
 * so retrying in a loop doesn't help.
 */
export const ACTION_LIMITS = {
  /** Checkout sessions started, by one person, in an hour. */
  checkout: { windowSeconds: 60 * 60, max: 10 },
  /** Team links made, for one team, in a day. */
  team_invite: { windowSeconds: 24 * 60 * 60, max: 50 },
  /** Score reports, by one person for one game, in a day. */
  score_report: { windowSeconds: 24 * 60 * 60, max: 10 },
  /** Joining or leaving a season's waitlist, by one person, in an hour. */
  waitlist: { windowSeconds: 60 * 60, max: 5 },
  /** Private concerns sent to the league, by one person, in a day. */
  concern: { windowSeconds: 24 * 60 * 60, max: 5 },
  /** Answers to lost and found posts, by one person, in a day. */
  lost_found_answer: { windowSeconds: 24 * 60 * 60, max: 20 },
  /** Messages in lost and found conversations, by one person, in a day. */
  lost_found_message: { windowSeconds: 24 * 60 * 60, max: 60 },
} as const;

export type LimitedAction = keyof typeof ACTION_LIMITS;

/** Counts one `action` for `subject` and says whether it is allowed. */
export function withinActionLimit(
  db: Db,
  action: LimitedAction,
  subject: string,
  now: Date,
): Promise<boolean> {
  return consumeRateLimit(
    db,
    `action:${action}:${subject}`,
    ACTION_LIMITS[action],
    now,
  );
}
