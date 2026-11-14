import { createHash } from "node:crypto";
import { APIError } from "better-auth/api";
import { allowSignInLink } from "@/db/queries/rate-limit";
import type { Db } from "@/db/queries/schedule";
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

type Link = { email: string; url: string };

/**
 * Wraps the sender so each inbox gets at most a few links per link lifetime
 * (`SIGN_IN_LINKS_PER_INBOX`). It runs after Better Auth's per-IP limit and
 * before any email goes; over the limit, the request answers 429.
 */
export function withinInboxLimit(
  db: Db,
  deliver: (link: Link) => Promise<void>,
): (link: Link) => Promise<void> {
  return async (link) => {
    if (!(await allowSignInLink(db, link.email, new Date())))
      throw new APIError("TOO_MANY_REQUESTS", {
        message: "Too many sign-in links for this address. Try again soon.",
      });
    await deliver(link);
  };
}
