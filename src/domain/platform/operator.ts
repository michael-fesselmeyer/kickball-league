/**
 * The platform operator: whoever runs and hosts the software, above the
 * league's owners. Operator identity comes only from the server's
 * environment (`OPERATOR_USER_IDS`), never from the database, so nothing in
 * the app can grant it, remove it or see past it. See ADR 0009.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Account ids from a comma-separated list; anything that isn't an id is ignored. */
export function parseOperatorIds(raw: string | undefined): ReadonlySet<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((id) => id.trim().toLowerCase())
      .filter((id) => UUID.test(id)),
  );
}

export function isOperator(
  userId: string | null,
  operators: ReadonlySet<string>,
): boolean {
  return userId !== null && operators.has(userId.toLowerCase());
}

/** Operator actions need a sign-in this recent. */
export const FRESH_SIGN_IN_MS = 15 * 60 * 1000;

export function signedInRecently(signedInAt: Date | null, now: Date): boolean {
  return (
    signedInAt !== null &&
    now.getTime() - signedInAt.getTime() <= FRESH_SIGN_IN_MS
  );
}

/**
 * - `active`: everything works.
 * - `read_only`: everything is visible; nothing changes, except the operator.
 * - `paused`: public pages show a neutral notice. Nothing changes, except the
 *   operator, and owners can still sign in and download the league's data.
 */
export type SiteStatus = "active" | "read_only" | "paused";
export const SITE_STATUSES: readonly SiteStatus[] = [
  "active",
  "read_only",
  "paused",
];
export const isSiteStatus = (value: string): value is SiteStatus =>
  (SITE_STATUSES as readonly string[]).includes(value);

/** Whether a person may change anything right now. */
export function canWrite(status: SiteStatus, operator: boolean): boolean {
  return status === "active" || operator;
}

/**
 * Paths that stay reachable while the site is paused: the signed-in app
 * (where owners export their data, and where writes are refused anyway),
 * signing in, the operator console and the notice itself.
 */
export function reachableWhilePaused(pathname: string): boolean {
  return [
    "/app",
    "/sign-in",
    "/sign-up",
    "/operator",
    "/paused",
    "/api/auth",
  ].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Features the operator can switch off for the league. */
export const FEATURES = {
  subs: "Sub finder",
  announcements: "Announcements",
  weather: "Weather forecasts and rain alerts",
} as const;
export type Feature = keyof typeof FEATURES;
export const FEATURE_KEYS: readonly Feature[] = [
  "subs",
  "announcements",
  "weather",
];
export const isFeature = (value: string): value is Feature =>
  Object.hasOwn(FEATURES, value);

export function featureOn(
  disabled: readonly string[],
  feature: Feature,
): boolean {
  return !disabled.includes(feature);
}

/** The global roles the operator can give a person. */
export type GrantableRole = "player" | "admin" | "owner";
export const isGrantableRole = (value: string): value is GrantableRole =>
  value === "player" || value === "admin" || value === "owner";
