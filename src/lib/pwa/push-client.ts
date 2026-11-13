/**
 * The browser side of push opt-in, for the profile page. Everything it
 * touches is passed in, so the tests run it without a browser.
 *
 * Push needs the service worker that production builds register on every
 * page (src/lib/pwa/install.ts). On iPhone it also needs the app installed
 * to the home screen (iOS 16.4 and later); Safari in a tab has no
 * PushManager, which shows up here as "unsupported".
 */

type PushSubscriptionLike = {
  endpoint: string;
  toJSON(): unknown;
  unsubscribe(): Promise<boolean>;
};

type PushManagerLike = {
  getSubscription(): Promise<PushSubscriptionLike | null>;
  subscribe(options: {
    userVisibleOnly: boolean;
    applicationServerKey: Uint8Array;
  }): Promise<PushSubscriptionLike>;
};

export type PushGlobals = {
  serviceWorker?:
    | {
        getRegistration(
          scope?: string,
        ): Promise<{ pushManager?: PushManagerLike } | undefined>;
      }
    | undefined;
  Notification?:
    | {
        permission: NotificationPermission;
        requestPermission(): Promise<NotificationPermission>;
      }
    | undefined;
  hasPushManager: boolean;
};

export function browserPushGlobals(): PushGlobals {
  const w = globalThis as typeof globalThis & {
    Notification?: PushGlobals["Notification"];
    PushManager?: unknown;
  };
  return {
    serviceWorker: w.navigator?.serviceWorker as PushGlobals["serviceWorker"],
    Notification: w.Notification,
    hasPushManager: typeof w.PushManager !== "undefined",
  };
}

/**
 * Where this device stands:
 * - unsupported: no push here (an iPhone tab, an old browser, or the
 *   service worker is not running);
 * - blocked: the person said no to notifications for this site;
 * - off / on: whether this device is subscribed.
 */
export type DeviceState =
  | { state: "unsupported" }
  | { state: "blocked" }
  | { state: "off" }
  | { state: "on"; endpoint: string };

async function pushManager(g: PushGlobals): Promise<PushManagerLike | null> {
  if (!g.serviceWorker || !g.Notification || !g.hasPushManager) return null;
  const registration = await g.serviceWorker.getRegistration("/");
  return registration?.pushManager ?? null;
}

export async function deviceState(g: PushGlobals): Promise<DeviceState> {
  const manager = await pushManager(g).catch(() => null);
  if (!manager || !g.Notification) return { state: "unsupported" };
  if (g.Notification.permission === "denied") return { state: "blocked" };
  const existing = await manager.getSubscription().catch(() => null);
  return existing && g.Notification.permission === "granted"
    ? { state: "on", endpoint: existing.endpoint }
    : { state: "off" };
}

/** The league's VAPID public key as the bytes `subscribe` wants. */
export function keyBytes(base64url: string): Uint8Array {
  const base64 = base64url.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export type Subscribed =
  | { ok: true; json: string; endpoint: string }
  | { ok: false; reason: "unsupported" | "blocked" | "failed" };

/**
 * Asks for permission if needed and subscribes this device with the
 * league's key. Reuses an existing subscription made with the same key.
 */
export async function subscribeDevice(
  g: PushGlobals,
  publicKey: string,
): Promise<Subscribed> {
  const manager = await pushManager(g).catch(() => null);
  if (!manager || !g.Notification) return { ok: false, reason: "unsupported" };
  const permission =
    g.Notification.permission === "default"
      ? await g.Notification.requestPermission()
      : g.Notification.permission;
  if (permission !== "granted") return { ok: false, reason: "blocked" };
  try {
    const subscription =
      (await manager.getSubscription()) ??
      (await manager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(publicKey),
      }));
    return {
      ok: true,
      json: JSON.stringify(subscription.toJSON()),
      endpoint: subscription.endpoint,
    };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** Unsubscribes this device; returns the endpoint it had, if any. */
export async function unsubscribeDevice(
  g: PushGlobals,
): Promise<string | null> {
  const manager = await pushManager(g).catch(() => null);
  const existing = await manager?.getSubscription().catch(() => null);
  if (!existing) return null;
  await existing.unsubscribe().catch(() => false);
  return existing.endpoint;
}
