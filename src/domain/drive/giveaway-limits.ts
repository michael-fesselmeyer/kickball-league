/**
 * The giveaway form's length and count limits, apart from the rest of
 * giveaway.ts so the admin form, a client component, can use them without
 * shipping the draw's server-only code (`node:crypto`) to the browser.
 */

export const MAX_PRIZE_LENGTH = 200;
export const MAX_DONOR_LENGTH = 80;
export const MAX_WINNERS = 20;
export const MIN_RULES_LENGTH = 20;
export const MAX_RULES_LENGTH = 5000;
export const MIN_REASON_LENGTH = 5;
export const MAX_REASON_LENGTH = 300;
