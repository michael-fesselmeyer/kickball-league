import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import expiredTokenError from "./fixtures/instagram/expired-token-error.json";
import longLivedToken from "./fixtures/instagram/long-lived-token.json";
import me from "./fixtures/instagram/me.json";
import media from "./fixtures/instagram/media.json";
import refreshedToken from "./fixtures/instagram/refreshed-token.json";
import token from "./fixtures/instagram/token.json";
import { GRAPH_ORIGIN, type InstagramFetch, TOKEN_URL } from "./instagram";

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Instagram, played back from responses recorded in the shape of the real
 * API (./fixtures/instagram). Tests use it so they never reach the
 * network, and development and the demo use it to connect and sync
 * without a real account: the sign-in step goes straight back to the
 * callback with FIXTURE_CODE.
 *
 * Photos are drawn on the fly: a small PNG whose colors come from the
 * address, so each post gets its own picture and no binary file is
 * committed.
 */

export const FIXTURE_CODE = "fixture-code";
/** A token the fixture treats as expired, to test reconnecting. */
export const EXPIRED_FIXTURE_TOKEN = "fixture-expired-token";

/**
 * Whether connecting and syncing use the fixture instead of Instagram.
 * Only when INSTAGRAM_FIXTURE is "true", no real app is configured, and the
 * server is not a production build outside the demo, so the league's site
 * can never show fixture photos.
 */
export function usesInstagramFixture(env: Env, demoOn: boolean): boolean {
  if (env.INSTAGRAM_FIXTURE !== "true") return false;
  if (env.INSTAGRAM_APP_ID || env.INSTAGRAM_APP_SECRET) return false;
  return env.NODE_ENV !== "production" || demoOn;
}

export type FixtureOptions = {
  /** Replaces the recorded media list, to test deletions and edits. */
  media?: { data: unknown[] };
  /** Photo addresses that answer 404. */
  missingImages?: readonly string[];
  /** Every call answers this way: Instagram is down. */
  unreachable?: boolean;
};

const json = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers({ "content-type": "application/json" }),
  json: async () => body,
  arrayBuffer: async () =>
    new TextEncoder().encode(JSON.stringify(body)).buffer,
});

const bearer = (headers: Record<string, string> | undefined) =>
  headers?.Authorization?.replace(/^Bearer /, "") ?? "";

export function fixtureFetch(options: FixtureOptions = {}): InstagramFetch {
  return async (address, init) => {
    if (options.unreachable) throw new TypeError("fetch failed");
    const url = new URL(address);
    const auth = bearer(init.headers);
    if (auth === EXPIRED_FIXTURE_TOKEN) return json(400, expiredTokenError);

    if (address === TOKEN_URL && init.method === "POST") {
      return init.body?.get("code") === FIXTURE_CODE
        ? json(200, token)
        : json(400, {
            error_type: "OAuthException",
            code: 400,
            error_message: "Invalid authorization code",
          });
    }
    if (url.origin === GRAPH_ORIGIN) {
      if (!auth) return json(400, expiredTokenError);
      if (url.pathname === "/access_token") return json(200, longLivedToken);
      if (url.pathname === "/refresh_access_token")
        return json(200, refreshedToken);
      if (url.pathname.endsWith("/me")) return json(200, me);
      if (url.pathname.endsWith("/me/media"))
        return json(200, options.media ?? media);
    }
    if (url.hostname.endsWith(".cdninstagram.com")) {
      if (options.missingImages?.includes(address))
        return { ...json(404, {}), ok: false };
      const bytes = fixturePhoto(address);
      return {
        ok: true,
        status: 200,
        headers: new Headers({
          "content-type": "image/png",
          "content-length": String(bytes.length),
        }),
        json: async () => {
          throw new SyntaxError("not JSON");
        },
        arrayBuffer: async () =>
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer,
      };
    }
    return json(404, { error: { message: "Unknown fixture address" } });
  };
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A square PNG of diagonal stripes in two colors picked from the seed. */
export function fixturePhoto(seed: string, size = 360): Buffer {
  const hash = createHash("sha256").update(seed).digest();
  const a = [hash[0]!, hash[1]!, hash[2]!];
  const b = [255 - hash[0]!, 255 - hash[1]!, 255 - hash[2]!];
  const band = 24 + (hash[3]! % 24);
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      const [r, g, bl] = Math.floor((x + y) / band) % 2 === 0 ? a : b;
      row[1 + x * 3] = r!;
      row[2 + x * 3] = g!;
      row[3 + x * 3] = bl!;
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
