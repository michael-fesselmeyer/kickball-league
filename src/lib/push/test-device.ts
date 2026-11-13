import {
  createDecipheriv,
  createECDH,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { b64url, type DeviceKeys } from "./web-push";

/**
 * A pretend browser for tests: the key pair and auth secret a real device
 * would create when it subscribes, and the decryption it would do when a
 * push arrives (RFC 8291 and RFC 8188, the receiving side). Lets the tests
 * read back exactly what the recorded push endpoint received.
 */
export type TestDevice = {
  keys: DeviceKeys;
  privateKey: Buffer;
};

export function testDevice(): TestDevice {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    keys: {
      p256dh: b64url.encode(ecdh.getPublicKey()),
      auth: b64url.encode(randomBytes(16)),
    },
    privateKey: ecdh.getPrivateKey(),
  };
}

/** Decrypts a single-record aes128gcm body the way the device would. */
export function decryptOnDevice(body: Uint8Array, device: TestDevice): Buffer {
  const data = Buffer.from(body);
  const salt = data.subarray(0, 16);
  const idLength = data[20] ?? 0;
  const asPublic = data.subarray(21, 21 + idLength);
  const sealed = data.subarray(21 + idLength);

  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(device.privateKey);
  const uaPublic = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(asPublic);
  const ikm = Buffer.from(
    hkdfSync(
      "sha256",
      secret,
      b64url.decode(device.keys.auth),
      Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]),
      32,
    ),
  );
  const cek = hkdfSync(
    "sha256",
    ikm,
    salt,
    Buffer.from("Content-Encoding: aes128gcm\0"),
    16,
  );
  const nonce = hkdfSync(
    "sha256",
    ikm,
    salt,
    Buffer.from("Content-Encoding: nonce\0"),
    12,
  );
  const decipher = createDecipheriv(
    "aes-128-gcm",
    Buffer.from(cek),
    Buffer.from(nonce),
  );
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  const padded = Buffer.concat([
    decipher.update(sealed.subarray(0, sealed.length - 16)),
    decipher.final(),
  ]);
  // Strip the delimiter (0x02 for the last record) and any zero padding.
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  if (padded[end] !== 2) throw new Error("Not a final record");
  return padded.subarray(0, end);
}

/** One request the recorded push endpoint received, decrypted. */
export type RecordedPush = {
  endpoint: string;
  headers: Record<string, string>;
  /** The notification JSON the device would read. */
  message: unknown;
};

/**
 * A recorded push endpoint: a `fetch` for the push sender that never
 * leaves the process. It decrypts each request with the matching test
 * device's keys, records it, and answers with the status `answer` picks
 * (201 Created by default, as push services do).
 */
export function recordedPushEndpoint(
  devices: ReadonlyMap<string, TestDevice>,
  answer: (endpoint: string) => number = () => 201,
) {
  const received: RecordedPush[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const endpoint = String(input);
    const device = devices.get(endpoint);
    if (!device) throw new TypeError(`No test device at ${endpoint}`);
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>),
    );
    const body = init?.body as Uint8Array;
    received.push({
      endpoint,
      headers,
      message: JSON.parse(decryptOnDevice(body, device).toString("utf8")),
    });
    const status = answer(endpoint);
    return new Response(null, {
      status,
      headers:
        status === 201 ? { Location: `${endpoint}/m/${received.length}` } : {},
    });
  }) as typeof globalThis.fetch;
  return { fetch, received };
}
