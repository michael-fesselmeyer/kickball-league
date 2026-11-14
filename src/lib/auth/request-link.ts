/**
 * Asks Better Auth to email a sign-in link, through its HTTP router.
 *
 * Better Auth applies its rate limits (5 sign-in links a minute per IP,
 * counted site-wide in the `rate_limit` table) only to requests that pass
 * through its router. Calling `auth.api.signInMagicLink` from a Server Action
 * skips the router, and with it the limit, so anyone could have the server
 * email an address over and over and use up the day's email allowance. The
 * sign-in form and the "confirm it's you" button use this instead.
 */
export type SignInLinkOutcome = "sent" | "rate_limited" | "failed";

/** Where Better Auth's routes live (src/app/api/auth/[...all]). */
const MAGIC_LINK_ROUTE = "/api/auth/sign-in/magic-link";

export async function requestSignInLink(
  handler: (request: Request) => Promise<Response>,
  input: {
    /** The site's address, BETTER_AUTH_URL. */
    baseURL: string;
    email: string;
    /** A same-site path, already made safe by `safeNextPath`. */
    callbackURL: string;
    /** The incoming request's headers, for the client's address. */
    headers: Headers;
  },
): Promise<SignInLinkOutcome> {
  const site = new URL(input.baseURL);
  const forwarded: Record<string, string> = {};
  for (const name of ["x-forwarded-for", "user-agent"]) {
    const value = input.headers.get(name);
    if (value) forwarded[name] = value;
  }
  const response = await handler(
    new Request(new URL(MAGIC_LINK_ROUTE, site), {
      method: "POST",
      headers: {
        ...forwarded,
        "content-type": "application/json",
        // Next has already checked the Server Action's origin.
        origin: site.origin,
      },
      body: JSON.stringify({
        email: input.email,
        callbackURL: input.callbackURL,
      }),
    }),
  );
  if (response.ok) return "sent";
  return response.status === 429 ? "rate_limited" : "failed";
}
