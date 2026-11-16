/**
 * Signs in with the code from a sign-in email, through Better Auth's HTTP
 * router so its per-IP limit on code attempts applies (as request-link.ts
 * does for links). On success the answer carries the session cookie, which
 * the Server Action passes on, and where the link would have gone.
 */
export type CodeSignIn =
  | { outcome: "signed-in"; setCookies: string[]; callbackURL: string }
  | { outcome: "refused" | "rate_limited" | "failed"; message?: string };

/** Where Better Auth's routes live (src/app/api/auth/[...all]). */
const CODE_ROUTE = "/api/auth/sign-in/code";

export async function requestCodeSignIn(
  handler: (request: Request) => Promise<Response>,
  input: {
    /** The site's address, BETTER_AUTH_URL. */
    baseURL: string;
    email: string;
    code: string;
    /** The incoming request's headers, for the client's address. */
    headers: Headers;
  },
): Promise<CodeSignIn> {
  const site = new URL(input.baseURL);
  const forwarded: Record<string, string> = {};
  for (const name of ["x-forwarded-for", "user-agent"]) {
    const value = input.headers.get(name);
    if (value) forwarded[name] = value;
  }
  const response = await handler(
    new Request(new URL(CODE_ROUTE, site), {
      method: "POST",
      headers: {
        ...forwarded,
        "content-type": "application/json",
        // Next has already checked the Server Action's origin.
        origin: site.origin,
      },
      body: JSON.stringify({ email: input.email, code: input.code }),
    }),
  );
  const body: unknown = await response.json().catch(() => null);
  const field = (name: string) =>
    typeof body === "object" && body !== null && name in body
      ? (body as Record<string, unknown>)[name]
      : undefined;
  const message = field("message");
  if (response.status === 429)
    return {
      outcome: "rate_limited",
      ...(typeof message === "string" ? { message } : {}),
    };
  if (response.status === 400)
    return {
      outcome: "refused",
      ...(typeof message === "string" ? { message } : {}),
    };
  if (!response.ok) return { outcome: "failed" };
  const callbackURL = field("callbackURL");
  return {
    outcome: "signed-in",
    setCookies: response.headers.getSetCookie(),
    callbackURL: typeof callbackURL === "string" ? callbackURL : "/app",
  };
}
