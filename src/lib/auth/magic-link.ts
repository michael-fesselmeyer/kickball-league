/**
 * Delivers a sign-in link. Real email (Resend) arrives with the message
 * outbox; until then the link is printed for local development and refused
 * in production, so a deployed site never logs a usable sign-in link.
 */
export function deliverMagicLink(
  { email, url }: { email: string; url: string },
  {
    nodeEnv,
    log,
  }: { nodeEnv: string | undefined; log: (message: string) => void },
): void {
  if (nodeEnv === "production") {
    throw new Error("Email delivery is not configured yet.");
  }
  log(`\n[auth] Magic link for ${email}:\n${url}\n`);
}
