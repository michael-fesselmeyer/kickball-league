import {
  createHash,
  createHmac,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

/**
 * The six-digit code that comes with every sign-in link (ADR 0077). It
 * signs in the same as the link, on whatever device the person typed their
 * email into: the iOS and Android apps, whose web view a link can't reach,
 * or a laptop when the email is read on a phone. Link and code are one
 * sign-in: using either uses up both.
 *
 * Six digits are guessable at scale, so a code is useful only with limits:
 * it expires with the link (15 minutes), a newer email replaces it, and
 * guesses are capped per address (SIGN_IN_CODE_GUESSES) as well as per IP.
 * The database holds only a keyed hash of each code, so a copy of it can't
 * be searched for the code offline.
 */

export const SIGN_IN_CODE_LENGTH = 6;

/** A uniformly random six-digit code, leading zeros kept. */
export function generateSignInCode(): string {
  return String(randomInt(0, 10 ** SIGN_IN_CODE_LENGTH)).padStart(
    SIGN_IN_CODE_LENGTH,
    "0",
  );
}

/**
 * The code as typed, or null. People paste codes with spaces or a dash in
 * the middle ("123 456"), so those are dropped; anything else is refused.
 */
export function normalizeSignInCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/[\s-]/g, "");
  return new RegExp(`^\\d{${SIGN_IN_CODE_LENGTH}}$`).test(digits)
    ? digits
    : null;
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** One pending code per address; the address itself is stored hashed. */
export function signInCodeIdentifier(email: string): string {
  const hash = createHash("sha256").update(normalizeEmail(email)).digest("hex");
  return `sign-in-code:${hash}`;
}

/** Keyed with the auth secret and bound to the address it was sent to. */
export function hashSignInCode(
  secret: string,
  email: string,
  code: string,
): string {
  return createHmac("sha256", secret)
    .update(`${normalizeEmail(email)}\n${code}`)
    .digest("hex");
}

export function signInCodeMatches(
  secret: string,
  email: string,
  code: string,
  storedHash: string,
): boolean {
  const given = Buffer.from(hashSignInCode(secret, email, code), "hex");
  const stored = Buffer.from(storedHash, "hex");
  return given.length === stored.length && timingSafeEqual(given, stored);
}

/** What the verification row for a pending code holds. */
export type SignInCodeRecord = {
  type: "sign-in-code";
  email: string;
  codeHash: string;
  /** The stored form of the link's token: its row is `magic-link:<link>`. */
  link: string;
  callbackURL: string;
};

export function parseSignInCodeRecord(value: string): SignInCodeRecord | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return null;
    const r = parsed as Record<string, unknown>;
    if (
      r.type !== "sign-in-code" ||
      typeof r.email !== "string" ||
      typeof r.codeHash !== "string" ||
      typeof r.link !== "string" ||
      typeof r.callbackURL !== "string"
    )
      return null;
    return {
      type: "sign-in-code",
      email: r.email,
      codeHash: r.codeHash,
      link: r.link,
      callbackURL: r.callbackURL,
    };
  } catch {
    return null;
  }
}
