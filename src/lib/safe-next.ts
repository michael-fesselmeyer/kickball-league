/** Where people land after signing in when no safe destination was given. */
export const DEFAULT_AFTER_SIGN_IN = "/app";

const BASE = "http://same-site.invalid";

/**
 * Turns an untrusted `?next=` value into a same-site path, or the default.
 * Without this, /sign-in?next=https://evil.example would send a freshly
 * signed-in player to an attacker's page (an open redirect).
 *
 * The value is resolved as a URL the way a browser would, so tricks like
 * `//evil.example`, `/\evil.example` or embedded tabs are caught by checking
 * the resulting origin, not by string matching alone.
 */
export function safeNextPath(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/"))
    return DEFAULT_AFTER_SIGN_IN;
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return DEFAULT_AFTER_SIGN_IN;
  }
  // Normalizing can itself produce a protocol-relative path: "/.//x" becomes
  // "//x", which a browser reads as another site. Found by the property test.
  if (url.origin !== BASE || url.pathname.startsWith("//"))
    return DEFAULT_AFTER_SIGN_IN;
  return `${url.pathname}${url.search}${url.hash}`;
}
