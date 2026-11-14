import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

/**
 * Encryption at rest for small secrets the database keeps: AES-256-GCM
 * with a key derived from the server's auth secret and a purpose, so a
 * database copy alone reads nothing, and a value sealed for one purpose
 * never opens as another. The additional data binds a value to its row:
 * one copied onto another row does not open.
 *
 * Stored as `v1.<iv>.<tag>.<ciphertext>`, base64url. Rotating the auth
 * secret makes every sealed value unreadable.
 */

const VERSION = "v1";

const keyFor = (secret: string, purpose: string): Buffer =>
  Buffer.from(
    hkdfSync(
      "sha256",
      secret,
      `kickball-league/${purpose}`,
      `${purpose}-v1`,
      32,
    ),
  );

export function seal(
  plaintext: string,
  {
    secret,
    purpose,
    bindTo,
  }: { secret: string; purpose: string; bindTo: string },
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(secret, purpose), iv);
  cipher.setAAD(Buffer.from(bindTo));
  const body = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [VERSION, iv, cipher.getAuthTag(), body]
    .map((part) =>
      typeof part === "string" ? part : part.toString("base64url"),
    )
    .join(".");
}

/** The plaintext, or null when the value was altered, moved or sealed with another key or purpose. */
export function unseal(
  stored: string,
  {
    secret,
    purpose,
    bindTo,
  }: { secret: string; purpose: string; bindTo: string },
): string | null {
  const [version, iv, tag, body, ...rest] = stored.split(".");
  // An empty plaintext seals to an empty body, so only a missing part fails.
  if (
    version !== VERSION ||
    !iv ||
    !tag ||
    body === undefined ||
    rest.length > 0
  )
    return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      keyFor(secret, purpose),
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
