import { createHmac, timingSafeEqual } from "node:crypto";
import { parseId, type UserId } from "@/domain/ids";

/**
 * A member's private events calendar link (docs/architecture.md, section 4).
 * Calendar apps can't sign in, so the link itself is the key: the person's
 * id, then a signature of the id and the feed's version made with the
 * server's secret. Nothing secret is stored, the link can be shown again at
 * any time, and resetting the feed (a new version) stops the old link.
 */

const SIGNATURE_LENGTH = 32;

function signature(secret: string, userId: UserId, version: number): string {
  return createHmac("sha256", secret)
    .update(`event-feed:${userId}:${version}`)
    .digest("base64url")
    .slice(0, SIGNATURE_LENGTH);
}

/** The token in a member's feed link. */
export function feedToken(
  secret: string,
  userId: UserId,
  version: number,
): string {
  return `${userId.replaceAll("-", "")}${signature(secret, userId, version)}`;
}

/** Whose feed a token claims to be, before its signature is checked. */
export function feedTokenUser(token: string): UserId | null {
  const hex = token.slice(0, 32);
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return parseId<UserId>(
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
  );
}

/** Whether a token is the current link for that person's feed. */
export function isFeedToken(
  secret: string,
  token: string,
  userId: UserId,
  version: number,
): boolean {
  const expected = Buffer.from(feedToken(secret, userId, version));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** The feed's path on this site. */
export const feedPath = (token: string) =>
  `/events/personal/${token}/calendar.ics`;
