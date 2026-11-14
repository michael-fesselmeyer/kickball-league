/**
 * Merged-away addresses (ADR 0041). When an admin merges a duplicate
 * account, its old address becomes an alias of the kept account. A sign-in
 * link asked for that address is sent to the kept account's address, and
 * nobody can start a fresh account with it, so the duplicate never comes
 * back.
 */

export const MAGIC_LINK_PATH = "/sign-in/magic-link";

export const MERGED_ADDRESS_REFUSAL =
  "This address was merged into another account. Sign in with that account's email address.";

/**
 * The sign-in request to send instead, or null to leave it alone: a request
 * for an alias goes to the kept account's address.
 */
export function followAlias(
  path: string,
  body: unknown,
  canonical: string | null,
): Record<string, unknown> | null {
  if (path !== MAGIC_LINK_PATH || !canonical) return null;
  if (!body || typeof body !== "object") return null;
  return { ...(body as Record<string, unknown>), email: canonical };
}

/** The address a sign-in request names, if any. */
export function requestedEmail(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const email = (body as { email?: unknown }).email;
  return typeof email === "string" ? email : null;
}
