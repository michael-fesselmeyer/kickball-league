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

/** A square PNG of a drawn game-day scene, its colors picked from the seed. */
export function fixturePhoto(seed: string, size = 360): Buffer {
  const hash = createHash("sha256").update(seed).digest();
  const byte = (i: number) => hash[i]!;
  // A simple drawn scene, so the demo's photos read as a game day rather
  // than test patterns: a sky (its evening tint from the seed), a mown
  // field and a red ball with its shadow. Still drawn, never a real photo.
  const horizon = Math.round(size * (0.42 + (byte(3) % 20) / 100));
  const warm = byte(4) / 255;
  const skyTop = [70 + warm * 60, 130 + warm * 20, 220 - warm * 60];
  const skyLow = [235, 200 + (1 - warm) * 40, 170 + (1 - warm) * 70];
  const grass = [70 + (byte(5) % 30), 150 + (byte(6) % 40), 70];
  const ball = {
    x: size * (0.25 + (byte(7) % 50) / 100),
    y: horizon + (size - horizon) * (0.35 + (byte(8) % 30) / 100),
    r: size * (0.08 + (byte(9) % 6) / 100),
  };
  const stripe = Math.max(8, Math.round(size / 9));
  const mix = (from: number[], to: number[], t: number) =>
    from.map((c, i) => Math.round(c + (to[i]! - c) * t));
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      let color: number[];
      if (y < horizon) color = mix(skyTop, skyLow, y / horizon);
      else {
        const shade = Math.floor(x / stripe) % 2 === 0 ? 1 : 0.9;
        color = grass.map((c) => Math.round(c * shade));
      }
      // The ball's shadow, then the ball, lit from the upper left.
      const sx = (x - ball.x - ball.r * 0.3) / (ball.r * 1.2);
      const sy = (y - ball.y - ball.r * 0.9) / (ball.r * 0.35);
      if (sx * sx + sy * sy <= 1) color = color.map((c) => c * 0.6);
      const dx = x - ball.x;
      const dy = y - ball.y;
      if (dx * dx + dy * dy <= ball.r * ball.r) {
        const lx = (dx + ball.r * 0.35) / ball.r;
        const ly = (dy + ball.r * 0.35) / ball.r;
        const light = Math.max(0, 1 - Math.sqrt(lx * lx + ly * ly));
        color = mix([200, 40, 45], [255, 170, 160], light * 0.8);
      }
      row[1 + x * 3] = Math.round(color[0]!);
      row[2 + x * 3] = Math.round(color[1]!);
      row[3 + x * 3] = Math.round(color[2]!);
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
