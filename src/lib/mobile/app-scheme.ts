/**
 * The iOS and Android apps' own URL scheme, which the system browser sheet
 * returns to after Google sign-in (ADR 0077). It is the app id
 * (MOBILE_APP_ID, a reverse domain such as `com.example.kickball`), as both
 * platforms recommend, so it can't collide with another app's scheme by
 * accident. The site and the native projects read the same setting.
 *
 * Scripts outside the Next.js build import this by a relative path, so it
 * must not import anything.
 */

/** A placeholder in a reserved domain until the league sets its own. */
export const DEFAULT_APP_ID = "com.example.kickball";

const APP_ID = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/;

export const isAppId = (value: unknown): value is string =>
  typeof value === "string" && APP_ID.test(value);

/** The configured app id, or the placeholder when unset or malformed. */
export function appId(raw: string | undefined): string {
  const value = raw?.trim().toLowerCase();
  return isAppId(value) ? value : DEFAULT_APP_ID;
}

/** URL schemes allow dots and ignore case, so the id is the scheme. */
export const appScheme = (raw: string | undefined) => appId(raw);
