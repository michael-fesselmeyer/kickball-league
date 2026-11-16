import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Hands a sign-in made in the system browser sheet to the iOS or Android
 * app (ADR 0075). Google refuses sign-in inside an app's web view, so the
 * app opens the sheet (ASWebAuthenticationSession on iOS, a Custom Tab on
 * Android), the person signs in there, and the site sends the sheet back to
 * the app's own address with a one-time code. The app trades the code for
 * a session in its web view.
 *
 * The trade is bound to the app that started it, the way PKCE binds an
 * OAuth code: the app makes a random verifier, keeps it, and sends only its
 * SHA-256 (the challenge). The code is worth nothing without the verifier,
 * so another app that catches the redirect gets nothing it can use, and a
 * code planted on someone's phone can't sign their app into another
 * account. Codes last two minutes and work once.
 */

/** How long the code from the sheet stays good. */
export const HANDOFF_EXPIRES_IN_SECONDS = 2 * 60;
/** How recent the sheet's sign-in must be for it to be handed over. */
export const HANDOFF_FRESH_SECONDS = 10 * 60;
/** The cookie that ties the sheet's return to the start it came from. */
export const HANDOFF_START_COOKIE = "kb-app-sign-in";

const BASE64URL_256 = /^[A-Za-z0-9_-]{43}$/;

/** A 256-bit value in base64url, as both verifiers and challenges are. */
export const isBase64Url256 = (value: unknown): value is string =>
  typeof value === "string" && BASE64URL_256.test(value);

/** The challenge for a verifier: base64url(SHA-256(verifier)), as in PKCE. */
export function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function verifierMatches(verifier: unknown, challenge: string): boolean {
  if (!isBase64Url256(verifier) || !isBase64Url256(challenge)) return false;
  const a = Buffer.from(challengeFor(verifier));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const newHandoffCode = () => randomBytes(32).toString("base64url");

/** Codes are stored by their hash, so the table holds none that works. */
export function handoffIdentifier(code: string): string {
  return `app-handoff:${createHash("sha256").update(code).digest("hex")}`;
}

export type HandoffRecord = {
  type: "app-handoff";
  userId: string;
  challenge: string;
};

export function parseHandoffRecord(value: string): HandoffRecord | null {
  try {
    const r: unknown = JSON.parse(value);
    if (typeof r !== "object" || r === null) return null;
    const o = r as Record<string, unknown>;
    if (
      o.type !== "app-handoff" ||
      typeof o.userId !== "string" ||
      !isBase64Url256(o.challenge)
    )
      return null;
    return { type: "app-handoff", userId: o.userId, challenge: o.challenge };
  } catch {
    return null;
  }
}

/** Where the sheet goes back to the app: `<scheme>:/sign-in?code=…`. */
export function appCallbackUrl(scheme: string, code: string): string {
  return `${scheme}:/sign-in?${new URLSearchParams({ code }).toString()}`;
}

/** Whether the sheet's sign-in happened after the start, and recently. */
export function isFreshForHandoff(
  signedInAt: Date,
  startedAt: number,
  now: Date,
): boolean {
  const at = signedInAt.getTime();
  return (
    at >= startedAt - 1000 &&
    at <= now.getTime() + 1000 &&
    now.getTime() - at <= HANDOFF_FRESH_SECONDS * 1000
  );
}

/**
 * The start cookie's value, `<challenge>.<started at, ms>`. It is HttpOnly
 * and lives only in the sheet's browser.
 */
export const startCookieValue = (challenge: string, startedAt: number) =>
  `${challenge}.${startedAt}`;

export function parseStartCookie(
  value: string | undefined,
): { challenge: string; startedAt: number } | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot < 0) return null;
  const challenge = value.slice(0, dot);
  const startedAt = Number(value.slice(dot + 1));
  if (!isBase64Url256(challenge) || !Number.isSafeInteger(startedAt))
    return null;
  return { challenge, startedAt };
}
