import { z } from "zod";

/**
 * The browsers' push services: Chrome and other Chromium browsers (Firebase
 * Cloud Messaging), Firefox (Mozilla's autopush), Safari (Apple) and Edge
 * (Windows Push Notification Services). A subscription names one of them.
 */
const PUSH_SERVICES = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
];

/**
 * Whether the outbox may POST to this address: https on the default port,
 * no credentials, and a known push service's host. Anything else would let
 * a signed-in person make the server send requests wherever they like.
 */
export function isPushServiceUrl(address: string): boolean {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.port === "" &&
    !url.username &&
    !url.password &&
    PUSH_SERVICES.some((host) => host.test(url.hostname))
  );
}

/**
 * A browser's push subscription, as `PushSubscription.toJSON()` sends it
 * from the profile page. Checked before it is stored: the endpoint is
 * where the outbox will POST, so only a known push service's https address
 * is accepted, and the keys must have the sizes the encryption needs
 * (RFC 8291).
 */
export const deviceSubscription = z.object({
  endpoint: z
    .url({ protocol: /^https$/ })
    .max(2048)
    .refine(isPushServiceUrl, {
      error: "must be a browser's push service",
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
