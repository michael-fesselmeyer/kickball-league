import { isFreshSession } from "./config";

/**
 * When a player may add a passkey (docs/architecture.md, section 4). Kept
 * apart from the Better Auth instance so it can be tested without one.
 *
 * Better Auth's passkey plugin serves the WebAuthn ceremonies over HTTP,
 * since the browser has to take part. Registering is gated here; signing in
 * with a passkey is open, like every other way of signing in. Listing,
 * renaming and removing go through the account page's Server Actions
 * instead, so their HTTP routes are switched off.
 */
export const PASSKEY_REGISTRATION_PATHS: readonly string[] = [
  "/passkey/generate-register-options",
  "/passkey/verify-registration",
];

export const PASSKEY_DISABLED_PATHS: readonly string[] = [
  "/passkey/list-user-passkeys",
  "/passkey/delete-passkey",
  "/passkey/update-passkey",
];

export type RegistrationRefusal = "signed_out" | "stale" | "frozen";

export const REGISTRATION_REFUSALS: Record<RegistrationRefusal, string> = {
  signed_out: "Sign in to add a passkey.",
  stale: "Confirm it's you again, then add the passkey.",
  frozen: "The league site is read-only right now.",
};

/**
 * Adding a passkey gives a new way into the account, so it needs a fresh
 * sign-in: someone holding an old session on a borrowed phone cannot add
 * their own passkey. A frozen site changes nothing. The demo allows it, so
 * visitors can try Face ID sign-in: its personas are recreated by the
 * nightly reset, and their passkeys go with them.
 */
export function passkeyRegistrationRefusal({
  signedInAt,
  now,
  writable,
}: {
  signedInAt: Date | null;
  now: Date;
  writable: boolean;
}): RegistrationRefusal | null {
  if (!signedInAt) return "signed_out";
  if (!writable) return "frozen";
  if (!isFreshSession(signedInAt, now)) return "stale";
  return null;
}

/**
 * The WebAuthn relying party is the site itself: its host name and origin
 * from BETTER_AUTH_URL, so a passkey made on the league's site only works
 * there.
 */
export function relyingParty(baseURL: string): {
  rpID: string;
  origin: string;
} {
  const url = new URL(baseURL);
  return { rpID: url.hostname, origin: url.origin };
}
