import { z } from "zod";
import { err, ok, type Result } from "@/domain/result";

/**
 * The Instagram API with Instagram Login (docs/architecture.md, section 17;
 * Meta's reference, API version below): the league's professional account
 * signs in on Instagram's own screen, and the site reads that account's
 * recent posts. Only the official API is used; nothing is scraped.
 *
 * Every call takes an injected `fetch`, so tests and local development use
 * the recorded fixture in ./fixtures/instagram and never reach the network.
 * Errors are worded for admins and never include a URL or a token.
 */

export const GRAPH_VERSION = "v27.0";
export const AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize";
export const TOKEN_URL = "https://api.instagram.com/oauth/access_token";
export const GRAPH_ORIGIN = "https://graph.instagram.com";
/** Reads the account's profile and media; nothing else is asked for. */
export const SCOPE = "instagram_business_basic";
/** How many recent posts a sync reads. */
export const RECENT_LIMIT = 25;
/** The largest photo the site copies. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export type InstagramFetch = (
  url: string,
  init: {
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: URLSearchParams | undefined;
    signal: AbortSignal;
  },
) => Promise<
  Pick<Response, "ok" | "status" | "json" | "arrayBuffer" | "headers">
>;

export type InstagramApp = {
  appId: string;
  appSecret: string;
  fetch: InstagramFetch;
  timeoutMs?: number;
};

/**
 * auth: the token was refused (expired, revoked, or the password changed);
 * an admin has to connect again. other: anything else; the next run tries
 * again.
 */
export type InstagramError = { kind: "auth" | "other"; message: string };

const failure = (kind: InstagramError["kind"], message: string) =>
  err<InstagramError>({ kind, message });

/** Where the admin's browser goes to sign in to Instagram. */
export function authorizeUrl(input: {
  appId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("state", input.state);
  // Instagram's own sign-in, without the Facebook option.
  url.searchParams.set("enable_fb_login", "false");
  return url.toString();
}

const apiError = z.object({
  error: z.object({
    message: z.string().optional(),
    type: z.string().optional(),
    code: z.number().optional(),
  }),
});
const oauthError = z.object({
  error_type: z.string(),
  error_message: z.string().optional(),
});

/**
 * Code 190 is an invalid or expired token; an OAuthException that is not a
 * rate limit (4, 17, 32, 613) is a refused sign-in or token too.
 */
function classify(status: number, body: unknown): InstagramError {
  const graph = apiError.safeParse(body);
  if (graph.success) {
    const { code, type } = graph.data.error;
    const rateLimited = code !== undefined && [4, 17, 32, 613].includes(code);
    if (code === 190 || (type === "OAuthException" && !rateLimited))
      return {
        kind: "auth",
        message: "Instagram no longer accepts the connection",
      };
    if (rateLimited)
      return { kind: "other", message: "Instagram asked us to slow down" };
  }
  if (oauthError.safeParse(body).success)
    return { kind: "auth", message: "Instagram refused the sign-in" };
  return { kind: "other", message: `Instagram answered ${status}` };
}

async function call<T>(
  app: Pick<InstagramApp, "fetch" | "timeoutMs">,
  url: string,
  schema: z.ZodType<T>,
  init: { method?: "GET" | "POST"; token?: string; body?: URLSearchParams },
): Promise<Result<T, InstagramError>> {
  try {
    const res = await app.fetch(url, {
      method: init.method ?? "GET",
      headers: init.token ? { Authorization: `Bearer ${init.token}` } : {},
      body: init.body,
      signal: AbortSignal.timeout(app.timeoutMs ?? 10_000),
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) return err(classify(res.status, body));
    const parsed = schema.safeParse(body);
    return parsed.success
      ? ok(parsed.data)
      : failure("other", "Instagram answered in a shape we don't understand");
  } catch (e) {
    return failure(
      "other",
      e instanceof Error && e.name === "TimeoutError"
        ? "Instagram took too long to answer"
        : "Instagram could not be reached",
    );
  }
}

const shortToken = z.object({
  data: z
    .array(
      z.object({
        access_token: z.string().min(1),
        user_id: z.union([z.string(), z.number()]).transform(String),
      }),
    )
    .min(1),
});

const longToken = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});

export type Token = { accessToken: string; expiresAt: Date };

/**
 * Turns the code from the sign-in redirect into a long-lived token (about
 * 60 days): first the short-lived token, then the exchange.
 */
export async function exchangeCode(
  app: InstagramApp,
  input: { code: string; redirectUri: string },
  now: Date,
): Promise<Result<Token, InstagramError>> {
  const short = await call(app, TOKEN_URL, shortToken, {
    method: "POST",
    body: new URLSearchParams({
      client_id: app.appId,
      client_secret: app.appSecret,
      grant_type: "authorization_code",
      redirect_uri: input.redirectUri,
      // Instagram appends "#_" to the code in the redirect.
      code: input.code.replace(/#_$/, ""),
    }),
  });
  if (!short.ok) return short;
  const url = new URL("/access_token", GRAPH_ORIGIN);
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", app.appSecret);
  const long = await call(app, url.toString(), longToken, {
    token: short.value.data[0]!.access_token,
  });
  if (!long.ok) return long;
  return ok({
    accessToken: long.value.access_token,
    expiresAt: new Date(now.getTime() + long.value.expires_in * 1000),
  });
}

/**
 * Extends a long-lived token by another 60 days. Instagram refreshes only
 * tokens at least a day old that have not expired.
 */
export async function refreshToken(
  app: Pick<InstagramApp, "fetch" | "timeoutMs">,
  token: string,
  now: Date,
): Promise<Result<Token, InstagramError>> {
  const url = new URL("/refresh_access_token", GRAPH_ORIGIN);
  url.searchParams.set("grant_type", "ig_refresh_token");
  const result = await call(app, url.toString(), longToken, { token });
  if (!result.ok) return result;
  return ok({
    accessToken: result.value.access_token,
    expiresAt: new Date(now.getTime() + result.value.expires_in * 1000),
  });
}

const profileSchema = z.object({
  user_id: z.union([z.string(), z.number()]).transform(String),
  username: z.string().min(1),
});

export type Profile = { externalId: string; username: string };

export async function profile(
  app: Pick<InstagramApp, "fetch" | "timeoutMs">,
  token: string,
): Promise<Result<Profile, InstagramError>> {
  const url = `${GRAPH_ORIGIN}/${GRAPH_VERSION}/me?fields=user_id,username`;
  const result = await call(app, url, profileSchema, { token });
  return result.ok
    ? ok({ externalId: result.value.user_id, username: result.value.username })
    : result;
}

const mediaSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      caption: z.string().optional(),
      media_type: z.enum(["IMAGE", "VIDEO", "CAROUSEL_ALBUM"]),
      media_url: z.url().optional(),
      thumbnail_url: z.url().optional(),
      permalink: z.url(),
      timestamp: z.string(),
    }),
  ),
});

export type RecentPost = {
  externalId: string;
  caption: string | null;
  mediaType: "image" | "video" | "carousel";
  /** The provider's short-lived address of the photo to copy. */
  imageUrl: string;
  permalink: string;
  takenAt: Date;
};

const MEDIA_TYPE = {
  IMAGE: "image",
  VIDEO: "video",
  CAROUSEL_ALBUM: "carousel",
} as const;

/** Instagram's timestamps look like 2026-09-13T18:04:11+0000. */
const parseTimestamp = (value: string): Date | null => {
  const date = new Date(value.replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * The account's most recent posts, newest first, with the photo to copy:
 * the image, a video's thumbnail, or a carousel's cover. A post with
 * neither (a video whose audio is licensed, say) or a link that is not
 * Instagram's is left out.
 */
export async function recentPosts(
  app: Pick<InstagramApp, "fetch" | "timeoutMs">,
  token: string,
): Promise<Result<{ posts: RecentPost[]; complete: boolean }, InstagramError>> {
  const fields =
    "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp";
  const url = `${GRAPH_ORIGIN}/${GRAPH_VERSION}/me/media?fields=${fields}&limit=${RECENT_LIMIT}`;
  const result = await call(app, url, mediaSchema, { token });
  if (!result.ok) return result;
  const posts: RecentPost[] = [];
  for (const item of result.value.data) {
    const imageUrl =
      item.media_type === "VIDEO" ? item.thumbnail_url : item.media_url;
    const takenAt = parseTimestamp(item.timestamp);
    if (!imageUrl || !takenAt || !isInstagramPermalink(item.permalink))
      continue;
    posts.push({
      externalId: item.id,
      caption: item.caption?.trim() || null,
      mediaType: MEDIA_TYPE[item.media_type],
      imageUrl,
      permalink: item.permalink,
      takenAt,
    });
  }
  posts.sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime());
  // Fewer than asked for means this is the whole account.
  return ok({ posts, complete: result.value.data.length < RECENT_LIMIT });
}

export const isInstagramPermalink = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "www.instagram.com";
  } catch {
    return false;
  }
};

/** Instagram serves photos from its own and Facebook's CDNs only. */
const IMAGE_HOSTS = [/(^|\.)cdninstagram\.com$/, /(^|\.)fbcdn\.net$/];
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type DownloadedImage = { contentType: string; bytes: Buffer };

/**
 * Copies one photo. Only https addresses on Instagram's CDNs are fetched,
 * so a post can never make the server request anything else, and only
 * JPEG, PNG or WebP up to MAX_IMAGE_BYTES is kept.
 */
export async function downloadImage(
  app: Pick<InstagramApp, "fetch" | "timeoutMs">,
  address: string,
  allowedHosts: readonly RegExp[] = IMAGE_HOSTS,
): Promise<Result<DownloadedImage, InstagramError>> {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return failure("other", "A photo's address was not a link");
  }
  if (
    url.protocol !== "https:" ||
    !allowedHosts.some((host) => host.test(url.hostname))
  )
    return failure("other", "A photo was not on Instagram's servers");
  try {
    const res = await app.fetch(url.toString(), {
      signal: AbortSignal.timeout(app.timeoutMs ?? 10_000),
    });
    if (!res.ok)
      return failure("other", `A photo could not be copied (${res.status})`);
    const contentType = (res.headers.get("content-type") ?? "")
      .split(";")[0]!
      .trim()
      .toLowerCase();
    if (!IMAGE_TYPES.has(contentType))
      return failure("other", "A photo was not a JPEG, PNG or WebP image");
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_IMAGE_BYTES)
      return failure("other", "A photo was too large to copy");
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES)
      return failure("other", "A photo was empty or too large to copy");
    return ok({ contentType, bytes });
  } catch {
    return failure("other", "A photo could not be copied");
  }
}
