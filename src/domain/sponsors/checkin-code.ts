import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The rotating check-in code (ADR 0016). The bar shows a QR code that
 * changes every CODE_WINDOW_MS; it is an HMAC of the window's number under
 * the sponsor's secret, so only the server can make or check one. A code
 * from the window before is still accepted, so a scan made just as the
 * code turns over still works. A photo of the code stops working within
 * two windows.
 *
 * No clock and no database: the caller passes the time.
 */

export const CODE_WINDOW_MS = 5 * 60 * 1000;

/** Base32 without padding or look-alikes, so a code reads aloud cleanly. */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const CODE_LENGTH = 10;
const CODE_FORMAT = new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`);

/** A new sponsor's secret: 32 random bytes as hex. */
export function newCheckinSecret(): string {
  return randomBytes(32).toString("hex");
}

const windowOf = (at: Date) => Math.floor(at.getTime() / CODE_WINDOW_MS);

function codeFor(secret: string, sponsorId: string, window: number): string {
  const mac = createHmac("sha256", secret)
    .update(`${sponsorId}:${window}`)
    .digest();
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++)
    code += ALPHABET[(mac[i] ?? 0) % ALPHABET.length];
  return code;
}

/** The code to show at `at`. */
export function checkinCode(
  secret: string,
  sponsorId: string,
  at: Date,
): string {
  return codeFor(secret, sponsorId, windowOf(at));
}

/** When the code shown at `at` turns over. */
export function codeTurnsOverAt(at: Date): Date {
  return new Date((windowOf(at) + 1) * CODE_WINDOW_MS);
}

/** Whether `code` is the current code or the one just before it. */
export function isCurrentCheckinCode(
  secret: string,
  sponsorId: string,
  code: string,
  now: Date,
): boolean {
  if (!CODE_FORMAT.test(code)) return false;
  const given = Buffer.from(code);
  const window = windowOf(now);
  return [window, window - 1].some((w) =>
    timingSafeEqual(given, Buffer.from(codeFor(secret, sponsorId, w))),
  );
}
