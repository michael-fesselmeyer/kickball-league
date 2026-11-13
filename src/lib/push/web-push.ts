import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  hkdfSync,
  randomBytes,
  sign,
} from "node:crypto";

/**
 * The Web Push protocol, written against the standards with Node's crypto
 * ([ADR 0010](../../../docs/adr/0010-web-push-without-a-library.md)):
 *
 * - RFC 8291: the message is encrypted for one device with its P-256 key
 *   and auth secret, so the push service only ever sees ciphertext.
 * - RFC 8188: the `aes128gcm` content coding that carries it.
 * - RFC 8292 (VAPID): a short-lived ES256 token signed with the league's
 *   key, so the push service knows who is sending.
 *
 * Nothing here sends anything: `pushRequest` builds the request and the
 * caller decides how to deliver it, which is how the tests use a recorded
 * endpoint instead of a real push service.
 */

export const b64url = {
  encode: (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url"),
  decode: (text: string) => Buffer.from(text, "base64url"),
};

/** The device's half of a push subscription, as the browser reports it. */
export type DeviceKeys = {
  /** Uncompressed P-256 public key (65 bytes), base64url. */
  p256dh: string;
  /** 16-byte authentication secret, base64url. */
  auth: string;
};

export type VapidKeys = {
  /** Uncompressed P-256 public key (65 bytes), base64url. */
  publicKey: string;
  /** P-256 private scalar (32 bytes), base64url. */
  privateKey: string;
  /** A mailto: or https: address the push service can contact. */
  subject: string;
};

/** A fresh VAPID key pair, for `scripts/vapid-keys.ts` and tests. */
export function generateVapidKeys(): Pick<
  VapidKeys,
  "publicKey" | "privateKey"
> {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  // Node drops leading zero bytes from the private scalar (about one key in
  // 256); VAPID keys are always the full 32 bytes.
  const scalar = ecdh.getPrivateKey();
  return {
    publicKey: b64url.encode(ecdh.getPublicKey()),
    privateKey: b64url.encode(
      Buffer.concat([Buffer.alloc(32 - scalar.length), scalar]),
    ),
  };
}

/** Whether a public and private key are a valid P-256 pair. */
export function isVapidPair(publicKey: string, privateKey: string): boolean {
  try {
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(b64url.decode(privateKey));
    return b64url.encode(ecdh.getPublicKey()) === publicKey;
  } catch {
    return false;
  }
}

const RECORD_SIZE = 4096;

const concat = (...parts: Uint8Array[]) => Buffer.concat(parts);
const ascii = (text: string) => Buffer.from(text, "ascii");
const hkdf = (ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, n: number) =>
  Buffer.from(hkdfSync("sha256", ikm, salt, info, n));

/** What the sender picks at random for each message; fixed only in tests. */
export type Ephemeral = {
  /** The sender's one-time P-256 private key (32 bytes). */
  privateKey: Uint8Array;
  /** 16 random bytes. */
  salt: Uint8Array;
};

const freshEphemeral = (): Ephemeral => {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { privateKey: ecdh.getPrivateKey(), salt: randomBytes(16) };
};

/**
 * Encrypts `plaintext` for one device (RFC 8291, section 3.4), as a single
 * aes128gcm record with no padding. Returns the request body.
 */
export function encryptForDevice(
  plaintext: Uint8Array,
  device: DeviceKeys,
  ephemeral: Ephemeral = freshEphemeral(),
): Buffer {
  const uaPublic = b64url.decode(device.p256dh);
  const authSecret = b64url.decode(device.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4)
    throw new Error("The device key is not an uncompressed P-256 key");
  if (authSecret.length !== 16)
    throw new Error("The device auth secret is not 16 bytes");
  if (plaintext.length > RECORD_SIZE - 17 - 86)
    throw new Error("The push message is too long");

  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(ephemeral.privateKey);
  const asPublic = ecdh.getPublicKey();
  const ecdhSecret = ecdh.computeSecret(uaPublic);

  const keyInfo = concat(
    ascii("WebPush: info\0"),
    uaPublic,
    Buffer.from(asPublic),
  );
  const ikm = hkdf(ecdhSecret, authSecret, keyInfo, 32);
  const cek = hkdf(
    ikm,
    ephemeral.salt,
    ascii("Content-Encoding: aes128gcm\0"),
    16,
  );
  const nonce = hkdf(
    ikm,
    ephemeral.salt,
    ascii("Content-Encoding: nonce\0"),
    12,
  );

  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // 0x02 marks the last (and only) record.
  const sealed = concat(
    cipher.update(concat(plaintext, Buffer.from([2]))),
    cipher.final(),
    cipher.getAuthTag(),
  );
  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(RECORD_SIZE);
  return concat(
    ephemeral.salt,
    recordSize,
    Buffer.from([asPublic.length]),
    asPublic,
    sealed,
  );
}

/** How long a VAPID token is good for. RFC 8292 allows at most 24 hours. */
const TOKEN_SECONDS = 12 * 60 * 60;

/**
 * The `Authorization` header for one push service (RFC 8292, section 3),
 * an ES256 JWT for the endpoint's origin plus the league's public key.
 */
export function vapidAuthorization(
  endpoint: string,
  vapid: VapidKeys,
  now: Date,
): string {
  const publicKey = b64url.decode(vapid.publicKey);
  const key = createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      d: vapid.privateKey,
      x: b64url.encode(publicKey.subarray(1, 33)),
      y: b64url.encode(publicKey.subarray(33, 65)),
    },
    format: "jwk",
  });
  const json = (value: object) =>
    b64url.encode(Buffer.from(JSON.stringify(value)));
  const unsigned = `${json({ typ: "JWT", alg: "ES256" })}.${json({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now.getTime() / 1000) + TOKEN_SECONDS,
    sub: vapid.subject,
  })}`;
  const signature = sign("sha256", Buffer.from(unsigned), {
    key,
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${unsigned}.${b64url.encode(signature)}, k=${vapid.publicKey}`;
}

export type PushRequest = {
  endpoint: string;
  method: "POST";
  headers: Record<string, string>;
  body: Buffer;
};

export type PushOptions = {
  /** Seconds the push service may hold the message for an offline device. */
  ttl: number;
  urgency: "very-low" | "low" | "normal" | "high";
  /**
   * Replaces an undelivered message with the same topic on the push
   * service, so a retry never stacks a second copy. At most 32
   * base64url characters.
   */
  topic?: string | undefined;
};

/** The HTTP request that delivers `payload` to one device. */
export function pushRequest(
  subscription: DeviceKeys & { endpoint: string },
  payload: string,
  vapid: VapidKeys,
  options: PushOptions,
  now: Date,
  ephemeral?: Ephemeral,
): PushRequest {
  if (
    options.topic !== undefined &&
    !/^[A-Za-z0-9_-]{1,32}$/.test(options.topic)
  )
    throw new Error("A push topic is 1 to 32 base64url characters");
  return {
    endpoint: subscription.endpoint,
    method: "POST",
    headers: {
      Authorization: vapidAuthorization(subscription.endpoint, vapid, now),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(Math.max(0, Math.floor(options.ttl))),
      Urgency: options.urgency,
      ...(options.topic ? { Topic: options.topic } : {}),
    },
    body: encryptForDevice(
      Buffer.from(payload, "utf8"),
      subscription,
      ephemeral,
    ),
  };
}
