import { describe, expect, it } from "vitest";
import type { PushSubscriptionId } from "@/domain/ids";
import { recordedPushEndpoint, testDevice } from "@/lib/push/test-device";
import { generateVapidKeys } from "@/lib/push/web-push";
import { pushSenderFrom, webPushSender } from "./push";

const vapid = { ...generateVapidKeys(), subject: "mailto:league@example.test" };
const ENDPOINT = "https://push.example.test/send/device-1";
const phone = testDevice();
const device = {
  id: "00000000-0000-4000-8000-000000000001" as PushSubscriptionId,
  endpoint: ENDPOINT,
  ...phone.keys,
};
const notification = {
  title: "Your game is postponed",
  body: "Aces vs Bees is rained out.",
  path: "/app/seasons/fall-2026",
  tag: "m1",
};
const options = { ttl: 86_400, urgency: "high" as const, topic: "m1" };

describe("webPushSender", () => {
  it("delivers an encrypted notification only the device can read", async () => {
    const endpoint = recordedPushEndpoint(new Map([[ENDPOINT, phone]]));
    const send = webPushSender({ vapid, fetch: endpoint.fetch });
    expect(await send(device, notification, options)).toEqual({
      ok: true,
      id: `${ENDPOINT}/m/1`,
    });
    expect(endpoint.received).toHaveLength(1);
    const [got] = endpoint.received;
    expect(got?.message).toEqual(notification);
    expect(got?.headers).toMatchObject({
      TTL: "86400",
      Urgency: "high",
      Topic: "m1",
      "Content-Encoding": "aes128gcm",
    });
    expect(got?.headers.Authorization).toContain(`k=${vapid.publicKey}`);
  });

  it.each([404, 410])("says a device is gone on %i", async (status) => {
    const endpoint = recordedPushEndpoint(
      new Map([[ENDPOINT, phone]]),
      () => status,
    );
    const send = webPushSender({ vapid, fetch: endpoint.fetch });
    expect(await send(device, notification, options)).toEqual({
      ok: false,
      gone: true,
      error: `The push service refused the message (${status})`,
    });
  });

  it("keeps a device on other refusals and on network errors", async () => {
    const endpoint = recordedPushEndpoint(
      new Map([[ENDPOINT, phone]]),
      () => 503,
    );
    expect(
      await webPushSender({ vapid, fetch: endpoint.fetch })(
        device,
        notification,
        options,
      ),
    ).toMatchObject({ ok: false, gone: false });
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    expect(
      await webPushSender({ vapid, fetch: offline })(
        device,
        notification,
        options,
      ),
    ).toEqual({
      ok: false,
      gone: false,
      error: "Could not reach the push service at push.example.test",
    });
  });

  it("drops a subscription whose keys cannot be used, without sending", async () => {
    const endpoint = recordedPushEndpoint(new Map([[ENDPOINT, phone]]));
    const send = webPushSender({ vapid, fetch: endpoint.fetch });
    expect(
      await send({ ...device, auth: "AAAA" }, notification, options),
    ).toMatchObject({ ok: false, gone: true });
    expect(endpoint.received).toEqual([]);
  });

  it("never puts a key in an error", async () => {
    const endpoint = recordedPushEndpoint(
      new Map([[ENDPOINT, phone]]),
      () => 400,
    );
    const result = await webPushSender({ vapid, fetch: endpoint.fetch })(
      device,
      notification,
      options,
    );
    expect(JSON.stringify(result)).not.toContain(vapid.privateKey);
  });
});

describe("pushSenderFrom", () => {
  it("is off until both keys are set", () => {
    expect(pushSenderFrom({ subject: "https://league.example.test" })).toBeNull();
    expect(
      pushSenderFrom({
        publicKey: vapid.publicKey,
        subject: "https://league.example.test",
      }),
    ).toBeNull();
    expect(pushSenderFrom(vapid)).toBeTypeOf("function");
  });
});
