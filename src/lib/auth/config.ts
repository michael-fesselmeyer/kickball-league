/**
 * Sign-in policy, kept separate from the Better Auth instance so it can be
 * read and tested without a database. See docs/architecture.md, section 4.
 */
const MINUTE = 60;
const DAY = 24 * 60 * MINUTE;

/** Players use their own devices, so a session lasts a season and renews on use. */
export const SESSION_EXPIRES_IN_SECONDS = 90 * DAY;
/** At most one session write per day, however often the site is used. */
export const SESSION_UPDATE_AGE_SECONDS = 1 * DAY;
/** Sensitive actions need a session confirmed this recently (enforced from Phase 2). */
export const SESSION_FRESH_AGE_SECONDS = 15 * MINUTE;
/** Magic links are single use and short-lived. */
export const MAGIC_LINK_EXPIRES_IN_SECONDS = 15 * MINUTE;

/**
 * Sign-in links are the one email anyone can ask for, and they are sent
 * outside the outbox's email budget (docs/architecture.md, section 5), so
 * they get limits of their own:
 *
 * - From one IP address, 20 a day: enough for a bar's Wi-Fi on league night,
 *   far short of the free plan's 100 emails a day. Better Auth counts it and
 *   restarts the count after a day without a link from that address.
 * - To one inbox, 3 for each link lifetime (15 minutes). Someone asking for
 *   links to another person's address can't flood it, and can't lock its
 *   owner out either: a link from the last window still works while the
 *   next one waits.
 */
export const SIGN_IN_LINKS_PER_IP = { window: DAY, max: 20 } as const;
export const SIGN_IN_LINKS_PER_INBOX = {
  windowSeconds: MAGIC_LINK_EXPIRES_IN_SECONDS,
  max: 3,
} as const;

/**
 * Rate-limit counts live in Postgres (the `rate_limit` table), so the limits
 * apply to the whole site, not to each server instance. The rules are
 * Better Auth's own, apart from sign-in links (above): 5 sign-in link checks
 * a minute per IP, 3 other sign-in attempts per 10 seconds, 100 other
 * requests per 10 seconds.
 */
export const RATE_LIMIT = {
  storage: "database",
  customRules: { "/sign-in/magic-link": SIGN_IN_LINKS_PER_IP },
} as const;

/**
 * Better Auth routes the site never calls, switched off so nobody can call
 * them either (they answer 404). The profile form is the only way to change
 * a name, with its checks and the read-only switch; the security page signs
 * devices out, and refuses in the demo, whose personas every visitor shares;
 * and Google's tokens stay on the server.
 */
export const UNUSED_AUTH_PATHS: readonly string[] = [
  "/update-user",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
  "/get-access-token",
  "/refresh-token",
  "/account-info",
];

/** Counters untouched this long are swept by the daily outbox job. */
export const RATE_LIMIT_KEEP_MS = DAY * 1000;

/**
 * Whether a session was signed in recently enough for a sensitive action,
 * such as deleting the account. Renewing a session does not make it fresh:
 * only a new sign-in does.
 */
export function isFreshSession(signedInAt: Date, now: Date): boolean {
  const age = now.getTime() - signedInAt.getTime();
  return age >= 0 && age <= SESSION_FRESH_AGE_SECONDS * 1000;
}
