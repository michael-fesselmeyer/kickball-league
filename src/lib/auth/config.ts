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
