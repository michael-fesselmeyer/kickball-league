import { timingSafeEqual } from "node:crypto";

/** Constant-time comparison, so the secret cannot be guessed by timing. */
function matches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Lets a scheduled job run only when called with `Authorization: Bearer
 * $CRON_SECRET`, as Vercel Cron does. Returns the refusal to send, or null
 * when the caller may proceed. Without a secret every call is refused.
 */
export function refuseUnlessCron(
  request: Request,
  secret: string | undefined,
): Response | null {
  if (!secret) return new Response("Jobs are not configured", { status: 503 });
  const auth = request.headers.get("authorization") ?? "";
  if (!matches(auth, `Bearer ${secret}`))
    return new Response("Unauthorized", { status: 401 });
  return null;
}
