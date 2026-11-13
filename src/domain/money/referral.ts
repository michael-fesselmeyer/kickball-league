import { randomInt } from "node:crypto";

/**
 * Referral links (product-spec.md, "Referral credits"): /r/<code>. A code is
 * eight letters and digits that are hard to confuse when read aloud or typed
 * from a screenshot; it only says who referred, so it need not be secret.
 */

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const LENGTH = 8;

export function newReferralCode(pick = (n: number) => randomInt(n)): string {
  let code = "";
  for (let i = 0; i < LENGTH; i++) code += ALPHABET[pick(ALPHABET.length)];
  return code;
}

/** A typed or linked code, upper-cased, or null when it cannot be one. */
export function normalizeReferralCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return code.length === LENGTH && [...code].every((c) => ALPHABET.includes(c))
    ? code
    : null;
}

/** The cookie that remembers a referral link until the person registers. */
export const REFERRAL_COOKIE = "kb_ref";
export const REFERRAL_COOKIE_DAYS = 30;
