/**
 * Where the iOS and Android apps load the league from (docs/mobile.md,
 * ADR 0074). The apps are a native shell around the site itself, so the
 * only thing they need to know is its address. It comes from
 * MOBILE_APP_URL when the native projects are synced, never from the code,
 * so the same shell points at a dev server on the laptop or at the
 * production site.
 *
 * capacitor.config.ts imports this file by a relative path, outside the
 * Next.js build, so it must not import anything.
 */

export const APP_URL_VARIABLE = "MOBILE_APP_URL";

/** Hosts that reach a dev server on this machine from a simulator. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type AppUrl = {
  /** The site's origin, without a trailing slash. */
  origin: string;
  /** The host name alone, without the port. */
  hostname: string;
  /**
   * A plain-http dev server. The Android shell must be told to allow it;
   * iOS allows http to the loopback address by default.
   */
  cleartext: boolean;
};

export class AppUrlError extends Error {
  override name = "AppUrlError";
}

/**
 * Reads and checks the site address. Production is https only. Plain http
 * is allowed for the loopback address, which the iOS Simulator shares with
 * the laptop and an Android emulator reaches through `adb reverse`, and
 * which browsers treat as a secure context, so the service worker and
 * offline score entry still run.
 */
export function resolveAppUrl(raw: string | undefined): AppUrl {
  const value = raw?.trim();
  if (!value)
    throw new AppUrlError(
      `Set ${APP_URL_VARIABLE} to the site the apps should open, for example http://localhost:3000 for a dev server (docs/mobile.md).`,
    );
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppUrlError(`${APP_URL_VARIABLE} is not a web address.`);
  }
  if (url.username || url.password)
    throw new AppUrlError(
      `${APP_URL_VARIABLE} must not carry a user name or password.`,
    );
  if (url.pathname !== "/" || url.search || url.hash)
    throw new AppUrlError(
      `${APP_URL_VARIABLE} must be the site's origin alone, with no path, query or fragment.`,
    );
  const loopback = LOOPBACK.has(url.hostname);
  if (url.protocol === "http:" && !loopback)
    throw new AppUrlError(
      `${APP_URL_VARIABLE} must use https, except for a dev server on localhost.`,
    );
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new AppUrlError(`${APP_URL_VARIABLE} must be an http(s) address.`);
  return {
    origin: url.origin,
    hostname: url.hostname,
    cleartext: url.protocol === "http:",
  };
}

/**
 * The domains for the iOS app's WKAppBoundDomains list. WKWebView runs a
 * site's service worker only on an app-bound domain, and the offline game
 * page and score outbox depend on it. Capacitor also needs `localhost`,
 * where it serves the shell's own pages.
 */
export function appBoundDomains(app: AppUrl): string[] {
  const host = app.hostname.replace(/^\[|\]$/g, "");
  return host === "localhost" ? ["localhost"] : [host, "localhost"];
}
