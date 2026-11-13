import type { PushSubscriptionId } from "@/domain/ids";
import {
  type PushOptions,
  pushRequest,
  type VapidKeys,
} from "@/lib/push/web-push";

/** One subscribed device, as the outbox reads it. */
export type PushDevice = {
  id: PushSubscriptionId;
  endpoint: string;
  p256dh: string;
  auth: string;
};

/**
 * What the service worker receives (public/sw.js, the push handler). The
 * tag is the message id, so a repeat replaces the notification on screen.
 */
export type PushNotification = {
  title: string;
  body: string;
  path: string;
  tag: string;
};

export type PushOutcome =
  | { ok: true; id: string | null }
  /** gone: the push service dropped this subscription; delete it. */
  | { ok: false; gone: boolean; error: string };

export type PushSender = (
  device: PushDevice,
  notification: PushNotification,
  options: PushOptions,
) => Promise<PushOutcome>;

/**
 * Delivers web push with the league's VAPID keys. Every push service
 * speaks the same protocol, so this is one POST to the device's endpoint.
 * Failures come back as a short message that never includes a key.
 */
export function webPushSender({
  vapid,
  fetch = globalThis.fetch,
  now = () => new Date(),
}: {
  vapid: VapidKeys;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
}): PushSender {
  return async (device, notification, options) => {
    let request;
    try {
      request = pushRequest(
        device,
        JSON.stringify(notification),
        vapid,
        options,
        now(),
      );
    } catch (error) {
      return {
        ok: false,
        // A subscription whose keys cannot be used will never work.
        gone: true,
        error: error instanceof Error ? error.message : "Bad subscription",
      };
    }
    let response: Response;
    try {
      response = await fetch(request.endpoint, {
        method: request.method,
        headers: request.headers,
        body: new Uint8Array(request.body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return {
        ok: false,
        gone: false,
        error: `Could not reach the push service at ${new URL(device.endpoint).host}`,
      };
    }
    if (response.ok) return { ok: true, id: response.headers.get("Location") };
    return {
      ok: false,
      gone: response.status === 404 || response.status === 410,
      error: `The push service refused the message (${response.status})`,
    };
  };
}

/** The push sender when VAPID keys are configured; otherwise push is off. */
export function pushSenderFrom(source: {
  publicKey?: string | undefined;
  privateKey?: string | undefined;
  subject: string;
}): PushSender | null {
  if (!source.publicKey || !source.privateKey) return null;
  return webPushSender({
    vapid: {
      publicKey: source.publicKey,
      privateKey: source.privateKey,
      subject: source.subject,
    },
  });
}
