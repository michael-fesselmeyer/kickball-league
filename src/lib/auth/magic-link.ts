import { createHash } from "node:crypto";
import { renderMagicLinkEmail } from "@/emails/magic-link-email";
import type { EmailSender } from "@/services/email";
import { MAGIC_LINK_EXPIRES_IN_SECONDS } from "./config";

/**
 * Delivers a sign-in link: by email when email is configured; otherwise the
 * link is printed for local development and refused in production, so a
 * deployed site never logs a usable sign-in link.
 */
export async function deliverMagicLink(
  { email, url }: { email: string; url: string },
  {
    nodeEnv,
    log,
    send,
  }: {
    nodeEnv: string | undefined;
    log: (message: string) => void;
    send?: EmailSender | undefined;
  },
): Promise<void> {
  if (send) {
    const message = renderMagicLinkEmail({
      url,
      minutes: MAGIC_LINK_EXPIRES_IN_SECONDS / 60,
    });
    // Keyed by the link itself, so a retried request cannot send it twice.
    const key = createHash("sha256").update(url).digest("hex");
    const sent = await send({
      to: email,
      ...message,
      idempotencyKey: `magic-link/${key}`,
    });
    if (!sent.ok)
      throw new Error(`Could not send the sign-in email. ${sent.error}`);
    return;
  }
  if (nodeEnv === "production") {
    throw new Error("Email delivery is not configured yet.");
  }
  log(`\n[auth] Magic link for ${email}:\n${url}\n`);
}
