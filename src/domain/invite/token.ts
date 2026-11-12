import { createHash, randomBytes } from "node:crypto";

/**
 * Invite link tokens. The link carries the token; the database keeps only its
 * SHA-256, so a leaked table holds no working links.
 */

/** 32 random bytes as URL-safe base64: 43 characters. */
export function newInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Whether a string could be a token, before touching the database. */
export function looksLikeInviteToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** How long a team link works. Captains can make a new one at any time. */
export const INVITE_DAYS = 30;

export function inviteExpiry(now: Date, days = INVITE_DAYS): Date {
  return new Date(now.getTime() + days * 86_400_000);
}
