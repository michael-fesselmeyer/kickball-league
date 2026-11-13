import { after } from "next/server";
import { txDb } from "@/db/client";
import { type DrainResult, drainOutbox, emptyDrain } from "@/db/queries/outbox";
import { ok } from "@/domain/result";
import { rendererFor } from "@/emails/templates";
import { env } from "@/env";
import { type EmailSender, resendSender } from "./email";
import { pushSenderFrom } from "./push";

/**
 * Prints each email instead of sending it, for local development without an
 * email provider (docs/architecture.md, section 10).
 */
export const consoleSender =
  (log: (line: string) => void): EmailSender =>
  async ({ to, subject, text, idempotencyKey }) => {
    log(`\n[outbox] To ${to}: ${subject}\n${text}\n`);
    return ok({ id: `console/${idempotencyKey ?? "none"}` });
  };

/**
 * Resend when it is configured; the console in development; otherwise
 * nothing, and messages stay queued until email is set up.
 */
export function outboxSender(
  source: {
    resendApiKey?: string | undefined;
    emailFrom?: string | undefined;
    nodeEnv?: string | undefined;
  },
  log: (line: string) => void = console.info,
): EmailSender | null {
  if (source.resendApiKey && source.emailFrom)
    return resendSender({
      apiKey: source.resendApiKey,
      from: source.emailFrom,
    });
  if (source.nodeEnv !== "production") return consoleSender(log);
  return null;
}

const sender = outboxSender({
  resendApiKey: env.RESEND_API_KEY,
  emailFrom: env.EMAIL_FROM,
  nodeEnv: process.env.NODE_ENV,
});

/** Web push when VAPID keys are set; otherwise push copies are suppressed. */
const pushSender = pushSenderFrom({
  publicKey: env.VAPID_PUBLIC_KEY,
  privateKey: env.VAPID_PRIVATE_KEY,
  subject: env.VAPID_SUBJECT ?? env.BETTER_AUTH_URL,
});

/**
 * Sends everything that is due, in batches, until the outbox is empty or
 * `maxBatches` is reached. Null when neither email nor push is configured.
 */
export async function drainOutboxNow(
  now: Date = new Date(),
  maxBatches = 10,
): Promise<DrainResult | null> {
  if (!sender && !pushSender) return null;
  const render = rendererFor({ siteUrl: env.BETTER_AUTH_URL });
  const total = emptyDrain();
  for (let batch = 0; batch < maxBatches; batch++) {
    const r = await drainOutbox(txDb, {
      send: sender,
      push: pushSender,
      render,
      now,
    });
    for (const key of Object.keys(total) as (keyof DrainResult)[])
      total[key] += r[key];
    if (Object.values(r).every((n) => n === 0)) break;
  }
  return total;
}

/**
 * Sends newly queued messages right after the response, so a notice usually
 * goes out within a second. The scheduled sweep catches anything this
 * misses. Call it after the transaction that queued them has committed.
 */
export function sendQueuedSoon(): void {
  after(async () => {
    try {
      await drainOutboxNow();
    } catch (error) {
      console.error(
        "[outbox] immediate send failed; the sweep will retry",
        error,
      );
    }
  });
}
