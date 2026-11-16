/**
 * How many players a guest team may bring. Kept apart from `tournament.ts`,
 * which imports Node's crypto, so the guest sign-up form can show the limits
 * without shipping a crypto polyfill to every visitor's phone.
 */
export const MIN_ROSTER = 4;
export const MAX_ROSTER = 30;
