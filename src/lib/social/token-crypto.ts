import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

/**
 * Encrypts a social account's access token for storage
 * (docs/adr/0020-instagram-photos-stored-in-postgres.md). AES-256-GCM with
 * a key derived from the server's auth secret, so a database copy alone
 * cannot use the token. The additional data binds a ciphertext to its
 * account row: one copied onto another row does not decrypt.
 *
 * Stored as `v1.<iv>.<tag>.<ciphertext>`, base64url. Rotating the auth
 * secret makes stored tokens unreadable, which only means connecting again.
 */

const VERSION = "v1";

const keyFrom = (secret: string): Buffer =>
  Buffer.from(
    hkdfSync(
      "sha256",
      secret,
      "kickball-league/social-token",
      "social-token-v1",
      32,
    ),
  );

export function encryptToken(
  token: string,
  secret: string,
  bindTo: string,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  cipher.setAAD(Buffer.from(bindTo));
  const body = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), body]
    .map((part) =>
      typeof part === "string" ? part : part.toString("base64url"),
    )
    .join(".");
}

/** The token, or null when the value was altered, moved or made with another key. */
export function decryptToken(
  stored: string,
  secret: string,
  bindTo: string,
): string | null {
  const [version, iv, tag, body, ...rest] = stored.split(".");
  if (version !== VERSION || !iv || !tag || !body || rest.length > 0)
    return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      keyFrom(secret),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAAD(Buffer.from(bindTo));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(body, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
