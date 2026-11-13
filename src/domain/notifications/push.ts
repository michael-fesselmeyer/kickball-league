import { z } from "zod";

/**
 * A browser's push subscription, as `PushSubscription.toJSON()` sends it
 * from the profile page. Checked before it is stored: the endpoint is
 * where the outbox will POST, so only an https address is accepted, and
 * the keys must have the sizes the encryption needs (RFC 8291).
 */
export const deviceSubscription = z.object({
  endpoint: z
    .url({ protocol: /^https$/ })
    .max(2048)
    .refine((url) => !new URL(url).username && !new URL(url).password, {
      error: "must not carry credentials",
    }),
  keys: z.object({
    // 65 bytes, uncompressed P-256 point.
    p256dh: z.string().regex(/^B[A-Za-z0-9_-]{86}$/),
    // 16 bytes.
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  }),
  userAgent: z
    .string()
    .transform((ua) => ua.slice(0, 300))
    .nullable()
    .default(null),
});

export type DeviceSubscription = z.infer<typeof deviceSubscription>;

/** Parses the JSON a page posted, or null when it is not a usable subscription. */
export function parseDeviceSubscription(
  json: unknown,
  userAgent: string | null,
): DeviceSubscription | null {
  if (typeof json !== "string" || json.length > 4000) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const parsed = deviceSubscription.safeParse(
    raw && typeof raw === "object" ? { ...raw, userAgent } : raw,
  );
  return parsed.success ? parsed.data : null;
}
