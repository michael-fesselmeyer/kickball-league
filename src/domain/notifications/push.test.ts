import { createECDH, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseDeviceSubscription } from "./push";

/** What a browser reports for a new subscription: a P-256 key and a 16-byte secret. */
const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
const keys = {
  p256dh: ecdh.getPublicKey().toString("base64url"),
  auth: randomBytes(16).toString("base64url"),
};
const json = (value: unknown) => JSON.stringify(value);
const valid = { endpoint: "https://push.example.test/send/abc", keys };

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
    ["an http endpoint", { ...valid, endpoint: "http://push.example.test/a" }],
    [
      "credentials in the endpoint",
      { ...valid, endpoint: "https://u:p@push.example.test/a" },
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
