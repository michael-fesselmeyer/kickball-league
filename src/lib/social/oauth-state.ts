import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The sign-in round trip's CSRF check: a random state goes to Instagram in
 * the address and into an httpOnly cookie, and the callback accepts only
 * the matching pair. The cookie lives ten minutes and only under the
 * Instagram admin path.
 */
export const STATE_COOKIE = "instagram_oauth_state";
export const STATE_COOKIE_PATH = "/app/admin/instagram";
export const STATE_MAX_AGE = 600;

export const newState = (): string => randomBytes(32).toString("base64url");

export function statesMatch(
  fromCookie: string | undefined,
  fromQuery: string | null,
): boolean {
  if (!fromCookie || !fromQuery) return false;
  const a = Buffer.from(fromCookie);
  const b = Buffer.from(fromQuery);
  return a.length === b.length && timingSafeEqual(a, b);
}
