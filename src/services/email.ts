import { z } from "zod";
import { err, ok, type Result } from "@/domain/result";

/** The parts of Resend's reply this sender reads; anything else is ignored. */
const resendReply = z.object({
  id: z.string().optional(),
  /** The error's name, such as `daily_quota_exceeded`. */
  name: z.string().optional(),
  message: z.string().optional(),
});

export type Email = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Resend sends a message once per key for 24 hours, so a retry cannot double-send. */
  idempotencyKey?: string;
};

export type EmailSender = (
  email: Email,
) => Promise<Result<{ id: string }, string>>;

/**
 * Sends email through Resend's REST API. Failures come back as a short
 * message that never includes the API key.
 */
export function resendSender({
  apiKey,
  from,
  fetch = globalThis.fetch,
}: {
  apiKey: string;
  from: string;
  fetch?: typeof globalThis.fetch;
}): EmailSender {
  return async ({ to, subject, html, text, idempotencyKey }) => {
    let response: Response;
    try {
      response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: JSON.stringify({ from, to: [to], subject, html, text }),
      });
    } catch {
      return err("Resend could not be reached.");
    }
    const parsed = resendReply.safeParse(
      await response.json().catch(() => ({})),
    );
    const body = parsed.success ? parsed.data : {};
    if (response.ok && body.id !== undefined) return ok({ id: body.id });
    const reason = body.message ?? response.statusText;
    const name = body.name ? ` ${body.name}` : "";
    return err(
      `Resend refused the email (${response.status}${name}): ${reason}`,
    );
  };
}
