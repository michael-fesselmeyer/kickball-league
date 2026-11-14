/**
 * Starts Google sign-in through Better Auth's HTTP router, so its sign-in
 * rate limit applies (3 starts per 10 seconds per IP), as sign-in links do
 * (request-link.ts). Each start writes a short-lived state row, so calling
 * `auth.api.signInSocial` from the Server Action, outside the router, let
 * anyone fill that table. The router's answer carries Google's address and
 * the state cookie the callback checks; the action passes both on.
 */
export type GoogleStart =
  | { outcome: "redirect"; url: string; setCookies: string[] }
  | { outcome: "rate_limited" | "failed" };

/** Where Better Auth's routes live (src/app/api/auth/[...all]). */
const SOCIAL_ROUTE = "/api/auth/sign-in/social";

export async function requestGoogleSignIn(
  handler: (request: Request) => Promise<Response>,
  input: {
    /** The site's address, BETTER_AUTH_URL. */
    baseURL: string;
    /** A same-site path, already made safe by `safeNextPath`. */
    callbackURL: string;
    /** The incoming request's headers, for the client's address. */
    headers: Headers;
  },
): Promise<GoogleStart> {
  const site = new URL(input.baseURL);
  const forwarded: Record<string, string> = {};
  for (const name of ["x-forwarded-for", "user-agent"]) {
    const value = input.headers.get(name);
    if (value) forwarded[name] = value;
  }
  const response = await handler(
    new Request(new URL(SOCIAL_ROUTE, site), {
      method: "POST",
      headers: {
        ...forwarded,
        "content-type": "application/json",
        // Next has already checked the Server Action's origin.
        origin: site.origin,
      },
      body: JSON.stringify({
        provider: "google",
        callbackURL: input.callbackURL,
        disableRedirect: true,
      }),
    }),
  );
  if (response.status === 429) return { outcome: "rate_limited" };
  if (!response.ok) return { outcome: "failed" };
  const body: unknown = await response.json().catch(() => null);
  const url =
    typeof body === "object" && body !== null && "url" in body
      ? body.url
      : null;
  if (typeof url !== "string") return { outcome: "failed" };
  return {
    outcome: "redirect",
    url,
    setCookies: response.headers.getSetCookie(),
  };
}

export type CookieToSet = {
  name: string;
  value: string;
  options: {
    path?: string;
    maxAge?: number;
    expires?: Date;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "lax" | "strict" | "none";
  };
};

/** One `Set-Cookie` header as a cookie Next's `cookies().set` can take. */
export function parseSetCookie(header: string): CookieToSet | null {
  const [pair = "", ...attributes] = header.split(";");
  const eq = pair.indexOf("=");
  if (eq <= 0) return null;
  const cookie: CookieToSet = {
    name: pair.slice(0, eq).trim(),
    value: pair.slice(eq + 1).trim(),
    options: {},
  };
  for (const attribute of attributes) {
    const [rawKey = "", ...rest] = attribute.split("=");
    const key = rawKey.trim().toLowerCase();
    const value = rest.join("=").trim();
    if (key === "path") cookie.options.path = value;
    else if (key === "max-age" && /^-?\d+$/.test(value))
      cookie.options.maxAge = Number(value);
    else if (key === "expires" && !Number.isNaN(Date.parse(value)))
      cookie.options.expires = new Date(value);
    else if (key === "httponly") cookie.options.httpOnly = true;
    else if (key === "secure") cookie.options.secure = true;
    else if (key === "samesite") {
      const same = value.toLowerCase();
      if (same === "lax" || same === "strict" || same === "none")
        cookie.options.sameSite = same;
    }
  }
  return cookie;
}
