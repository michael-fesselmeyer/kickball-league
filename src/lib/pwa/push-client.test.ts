import { describe, expect, it } from "vitest";
import { b64url, generateVapidKeys } from "@/lib/push/web-push";
import {
  deviceState,
  keyBytes,
  type PushGlobals,
  subscribeDevice,
  unsubscribeDevice,
} from "./push-client";

const ENDPOINT = "https://push.example.test/send/device-1";

/** A browser with a service worker, a push manager and a permission prompt. */
function browser({
  permission = "default" as NotificationPermission,
  answer = "granted" as NotificationPermission,
  subscribed = false,
  failSubscribe = false,
  worker = true,
} = {}) {
  const calls = { prompts: 0, subscribeKeys: [] as Uint8Array[], removed: 0 };
  let current: { endpoint: string } | null = subscribed
    ? { endpoint: ENDPOINT }
    : null;
  const subscription = () => ({
    endpoint: ENDPOINT,
    toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: "p", auth: "a" } }),
    unsubscribe: async () => {
      calls.removed++;
      current = null;
      return true;
    },
  });
  const notification = {
    permission,
    requestPermission: async () => {
      calls.prompts++;
      notification.permission = answer;
      return answer;
    },
  };
  const globals: PushGlobals = {
    hasPushManager: true,
    Notification: notification,
    serviceWorker: {
      getRegistration: async () =>
        worker
          ? {
              pushManager: {
                getSubscription: async () => (current ? subscription() : null),
                subscribe: async ({ applicationServerKey }) => {
                  if (failSubscribe) throw new Error("push service error");
                  calls.subscribeKeys.push(applicationServerKey);
                  current = { endpoint: ENDPOINT };
                  return subscription();
                },
              },
            }
          : undefined,
    },
  };
  return { globals, calls };
}

const { publicKey } = generateVapidKeys();

describe("keyBytes", () => {
  it("turns the base64url public key into its 65 bytes", () => {
    const bytes = keyBytes(publicKey);
    expect(bytes).toHaveLength(65);
    expect(b64url.encode(bytes)).toBe(publicKey);
  });
});

describe("deviceState", () => {
  it("is unsupported without a push manager or a running worker", async () => {
    expect(
      await deviceState({ ...browser().globals, hasPushManager: false }),
    ).toEqual({ state: "unsupported" });
    expect(await deviceState(browser({ worker: false }).globals)).toEqual({
      state: "unsupported",
    });
    expect(await deviceState({ hasPushManager: false })).toEqual({
      state: "unsupported",
    });
  });

  it("says when notifications are blocked", async () => {
    expect(await deviceState(browser({ permission: "denied" }).globals)).toEqual(
      { state: "blocked" },
    );
  });

  it("is on only with a subscription and permission", async () => {
    expect(
      await deviceState(
        browser({ permission: "granted", subscribed: true }).globals,
      ),
    ).toEqual({ state: "on", endpoint: ENDPOINT });
    expect(await deviceState(browser({ permission: "granted" }).globals)).toEqual(
      { state: "off" },
    );
  });
});

describe("subscribeDevice", () => {
  it("asks for permission, then subscribes with the league's key", async () => {
    const { globals, calls } = browser();
    const result = await subscribeDevice(globals, publicKey);
    expect(result).toEqual({
      ok: true,
      endpoint: ENDPOINT,
      json: JSON.stringify({
        endpoint: ENDPOINT,
        keys: { p256dh: "p", auth: "a" },
      }),
    });
    expect(calls.prompts).toBe(1);
    expect(calls.subscribeKeys.map((k) => b64url.encode(k))).toEqual([
      publicKey,
    ]);
  });

  it("does not ask again once allowed, and reuses a subscription", async () => {
    const { globals, calls } = browser({
      permission: "granted",
      subscribed: true,
    });
    expect((await subscribeDevice(globals, publicKey)).ok).toBe(true);
    expect(calls.prompts).toBe(0);
    expect(calls.subscribeKeys).toEqual([]);
  });

  it("stops when the person says no, or the browser cannot", async () => {
    expect(
      await subscribeDevice(browser({ answer: "denied" }).globals, publicKey),
    ).toEqual({ ok: false, reason: "blocked" });
    expect(
      await subscribeDevice(browser({ answer: "default" }).globals, publicKey),
    ).toEqual({ ok: false, reason: "blocked" });
    expect(
      await subscribeDevice(browser({ failSubscribe: true }).globals, publicKey),
    ).toEqual({ ok: false, reason: "failed" });
    expect(
      await subscribeDevice(browser({ worker: false }).globals, publicKey),
    ).toEqual({ ok: false, reason: "unsupported" });
  });
});

describe("unsubscribeDevice", () => {
  it("unsubscribes and returns the endpoint to forget", async () => {
    const { globals, calls } = browser({
      permission: "granted",
      subscribed: true,
    });
    expect(await unsubscribeDevice(globals)).toBe(ENDPOINT);
    expect(calls.removed).toBe(1);
    expect(await unsubscribeDevice(globals)).toBeNull();
  });
});
