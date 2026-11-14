import { seal, unseal } from "@/lib/crypto/sealed";

/**
 * Encrypts a social account's access token for storage
 * (docs/adr/0023-instagram-photos-stored-in-postgres.md), with the shared
 * sealing in src/lib/crypto/sealed.ts under its own purpose. The binding
 * ties a ciphertext to its account row. Rotating the auth secret makes
 * stored tokens unreadable, which only means connecting again.
 */

const PURPOSE = "social-token";

export function encryptToken(
  token: string,
  secret: string,
  bindTo: string,
): string {
  return seal(token, { secret, purpose: PURPOSE, bindTo });
}

/** The token, or null when the value was altered, moved or made with another key. */
export function decryptToken(
  stored: string,
  secret: string,
  bindTo: string,
): string | null {
  return unseal(stored, { secret, purpose: PURPOSE, bindTo });
}
