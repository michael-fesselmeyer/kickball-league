import type { Renderer } from "@/db/queries/outbox";
import { err } from "@/domain/result";
import { announcementEmail } from "./announcement";
import type { Template } from "./define";
import { paymentReminderEmail } from "./payment-reminder";
import type { RenderContext } from "./layout";

/**
 * Every email the outbox can send, by the template name stored on the
 * message row. Each kind of league message adds one.
 */
const TEMPLATES: Readonly<Record<string, Template>> = {
  announcement: announcementEmail,
  payment_reminder: paymentReminderEmail,
};

/** The outbox's renderer for this site. */
export function rendererFor(context: RenderContext): Renderer {
  return (name, payload) => {
    const template = TEMPLATES[name];
    return template
      ? template(payload, context)
      : err(`No email template named ${name}`);
  };
}
