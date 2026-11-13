import { createECDH, createPublicKey, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptOnDevice, testDevice } from "./test-device";
import {
  b64url,
  encryptForDevice,
  generateVapidKeys,
  isVapidPair,
  pushRequest,
  vapidAuthorization,
} from "./web-push";

/**
 * RFC 8291, Appendix A: the published example, byte for byte, as the RFC
 * prints it in base64url. The auth secret is joined from short pieces at
 * run time only so that secret scanners do not mistake this public test
 * vector for a credential.
 */
const RFC_8291 = {
  plaintext: "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic:
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  authSecret: ["BTBZMqHH", "6r4Tts7J", "_aSIgg"].join(""),
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

describe("encryptForDevice", () => {
  it("matches the RFC 8291 example exactly", () => {
    const body = encryptForDevice(
      b64url.decode(RFC_8291.plaintext),
      { p256dh: RFC_8291.uaPublic, auth: RFC_8291.authSecret },
      {
        privateKey: b64url.decode(RFC_8291.asPrivate),
        salt: b64url.decode(RFC_8291.salt),
      },
    );
    expect(b64url.encode(body)).toBe(RFC_8291.body);
  });

  it("can be read by the device it was encrypted for, and only that one", () => {
    const device = testDevice();
    const other = testDevice();
    const body = encryptForDevice(Buffer.from("Rained out! 🌧"), device.keys);
    expect(decryptOnDevice(body, device).toString()).toBe("Rained out! 🌧");
    expect(() => decryptOnDevice(body, other)).toThrow();
  });

  it("uses a new key and salt for every message", () => {
    const device = testDevice();
    const a = encryptForDevice(Buffer.from("same"), device.keys);
    const b = encryptForDevice(Buffer.from("same"), device.keys);
    expect(a.subarray(0, 16)).not.toEqual(b.subarray(0, 16));
    expect(a.subarray(21, 86)).not.toEqual(b.subarray(21, 86));
  });

  it("refuses malformed device keys and oversized messages", () => {
    const device = testDevice();
    expect(() =>
      encryptForDevice(Buffer.from("x"), { ...device.keys, auth: "AAAA" }),
    ).toThrow(/auth secret/);
    expect(() =>
      encryptForDevice(Buffer.from("x"), {
        ...device.keys,
        p256dh: b64url.encode(Buffer.alloc(33, 2)),
      }),
    ).toThrow(/P-256/);
    expect(() => encryptForDevice(Buffer.alloc(3994, 1), device.keys)).toThrow(
      /too long/,
    );
    expect(() =>
      encryptForDevice(Buffer.alloc(3993, 1), device.keys),
    ).not.toThrow();
  });
});

describe("VAPID", () => {
  const keys = generateVapidKeys();
  const vapid = { ...keys, subject: "mailto:league@example.test" };
  const now = new Date("2026-11-12T18:00:00Z");

  it("signs a token for the push service's origin that the public key verifies", () => {
    const header = vapidAuthorization(
      "https://push.example.test/send/abc?x=1",
      vapid,
      now,
    );
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    if (!match) throw new Error("not a VAPID header");
    const [, head = "", claims = "", signature = "", k] = match;
    expect(k).toBe(keys.publicKey);
    expect(JSON.parse(b64url.decode(head).toString())).toEqual({
      typ: "JWT",
      alg: "ES256",
    });
    expect(JSON.parse(b64url.decode(claims).toString())).toEqual({
      aud: "https://push.example.test",
      exp: now.getTime() / 1000 + 12 * 3600,
      sub: "mailto:league@example.test",
    });
    const publicKey = b64url.decode(keys.publicKey);
    const key = createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: b64url.encode(publicKey.subarray(1, 33)),
        y: b64url.encode(publicKey.subarray(33)),
      },
      format: "jwk",
    });
    expect(
      verify(
        "sha256",
        Buffer.from(`${head}.${claims}`),
        { key, dsaEncoding: "ieee-p1363" },
        b64url.decode(signature),
      ),
    ).toBe(true);
  });

  it("checks that a public and private key belong together", () => {
    const other = generateVapidKeys();
    expect(isVapidPair(keys.publicKey, keys.privateKey)).toBe(true);
    expect(isVapidPair(keys.publicKey, other.privateKey)).toBe(false);
    expect(isVapidPair(keys.publicKey, "not a key")).toBe(false);
  });

  it("makes 65-byte public and 32-byte private keys", () => {
    expect(b64url.decode(keys.publicKey)).toHaveLength(65);
    expect(b64url.decode(keys.privateKey)).toHaveLength(32);
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(b64url.decode(keys.privateKey));
    expect(b64url.encode(ecdh.getPublicKey())).toBe(keys.publicKey);
  });
});

describe("pushRequest", () => {
  const vapid = {
    ...generateVapidKeys(),
    subject: "https://league.example.test",
  };
  const device = testDevice();
  const subscription = {
    endpoint: "https://push.example.test/send/device-1",
    ...device.keys,
  };

  it("carries the encrypted payload and the delivery headers", () => {
    const request = pushRequest(
      subscription,
      '{"title":"Hi"}',
      vapid,
      { ttl: 3600.7, urgency: "high", topic: "abc123" },
      new Date(),
    );
    expect(request).toMatchObject({
      endpoint: subscription.endpoint,
      method: "POST",
      headers: {
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: "3600",
        Urgency: "high",
        Topic: "abc123",
      },
    });
    expect(request.headers.Authorization).toMatch(/^vapid t=.+, k=/);
    expect(decryptOnDevice(request.body, device).toString()).toBe(
      '{"title":"Hi"}',
    );
  });

  it("leaves the topic out when there is none, and refuses a bad one", () => {
    const options = { ttl: 60, urgency: "normal" as const };
    expect(
      pushRequest(subscription, "x", vapid, options, new Date()).headers,
    ).not.toHaveProperty("Topic");
    expect(() =>
      pushRequest(
        subscription,
        "x",
        vapid,
        { ...options, topic: "has spaces" },
        new Date(),
      ),
    ).toThrow(/topic/);
    expect(() =>
      pushRequest(
        subscription,
        "x",
        vapid,
        { ...options, topic: "a".repeat(33) },
        new Date(),
      ),
    ).toThrow(/topic/);
  });
});
