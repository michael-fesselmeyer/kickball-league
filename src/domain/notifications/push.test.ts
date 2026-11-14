import { createECDH, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isPushServiceUrl, parseDeviceSubscription } from "./push";

/** What a browser reports for a new subscription: a P-256 key and a 16-byte secret. */
const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
const keys = {
  p256dh: ecdh.getPublicKey().toString("base64url"),
  auth: randomBytes(16).toString("base64url"),
};
const json = (value: unknown) => JSON.stringify(value);
const valid = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys };

describe("parseDeviceSubscription", () => {
  it("accepts what a browser sends, with the user agent", () => {
    expect(
      parseDeviceSubscription(
        json({ ...valid, expirationTime: null }),
        "Mozilla/5.0 (Android)",
      ),
    ).toEqual({ ...valid, userAgent: "Mozilla/5.0 (Android)" });
  });

  it("keeps the user agent short", () => {
    expect(
      parseDeviceSubscription(json(valid), "x".repeat(1000))?.userAgent,
    ).toHaveLength(300);
  });

  it.each([
    [
      "an http endpoint",
      { ...valid, endpoint: "http://fcm.googleapis.com/fcm/send/a" },
    ],
    [
      "credentials in the endpoint",
      { ...valid, endpoint: "https://u:p@fcm.googleapis.com/fcm/send/a" },
    ],
    [
      "an endpoint that is not a push service",
      { ...valid, endpoint: "https://push.example.test/send/a" },
    ],
    ["no keys", { endpoint: valid.endpoint }],
    ["a short device key", { ...valid, keys: { ...keys, p256dh: "BAAA" } }],
    [
      "a long auth secret",
      { ...valid, keys: { ...keys, auth: "a".repeat(40) } },
    ],
  ])("refuses %s", (_, value) => {
    expect(parseDeviceSubscription(json(value), null)).toBeNull();
  });

  it("refuses what is not JSON, or too long to be a subscription", () => {
    expect(parseDeviceSubscription("{", null)).toBeNull();
    expect(parseDeviceSubscription(null, null)).toBeNull();
    expect(
      parseDeviceSubscription(
        json({ ...valid, padding: "x".repeat(5000) }),
        null,
      ),
    ).toBeNull();
  });
});

describe("isPushServiceUrl", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc:def",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/QAbc",
    "https://wns2-bl2p.notify.windows.com/w/?token=abc",
  ])("accepts the browsers' push services: %s", (url) => {
    expect(isPushServiceUrl(url)).toBe(true);
  });

  it.each([
    ["another site", "https://example.test/hook"],
    ["an address inside the network", "https://10.0.0.5/"],
    ["the cloud metadata address", "https://169.254.169.254/latest"],
    ["a lookalike host", "https://fcm.googleapis.com.example.test/x"],
    ["a host that only ends the same", "https://evilfcm.googleapis.com/x"],
    ["another port", "https://fcm.googleapis.com:8443/fcm/send/a"],
    ["plain http", "http://fcm.googleapis.com/fcm/send/a"],
    ["credentials", "https://u:p@web.push.apple.com/a"],
    ["not a URL", "fcm.googleapis.com/fcm/send/a"],
  ])("refuses %s", (_, url) => {
    expect(isPushServiceUrl(url)).toBe(false);
  });
});
