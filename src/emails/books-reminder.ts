import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/**
 * Reminds an owner that a permit application window opens, a permit
 * renews or the insurance certificate expires soon (ADR 0034). NYC Parks
 * has no public permit API, so the email points to the owners' permit
 * screen and the application is made by hand.
 */
export const booksReminderPayload = z.object({
  kind: z.enum(["application_opens", "permit_renews", "insurance_expires"]),
  /** Such as "permit PK-1001" or "the insurance certificate from Example Mutual". */
  subject: z.string().min(1),
  /** YYYY-MM-DD. */
  on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  daysLeft: z.number().int().min(0),
});

export type BooksReminderPayload = z.infer<typeof booksReminderPayload>;

const when = (days: number) =>
  days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;

const longDate = (on: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${on}T12:00:00Z`));

const WORDS = {
  application_opens: {
    subject: (s: string, d: string) => `Applications for ${s} open ${d}`,
    advice:
      "Open the request sheet to see the fields, dates and hours the league needs, then copy them into the NYC Parks application.",
  },
  permit_renews: {
    subject: (s: string, d: string) => `${capitalize(s)} renews ${d}`,
    advice:
      "Renew it with NYC Parks, then update its dates and document on the permits screen.",
  },
  insurance_expires: {
    subject: (s: string, d: string) => `${capitalize(s)} expires ${d}`,
    advice:
      "NYC Parks asks for a current certificate with each permit. Renew it, then add the new certificate on the permits screen.",
  },
} as const;

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const booksReminderEmail = defineTemplate(booksReminderPayload, (p, ctx) => {
  const words = WORDS[p.kind];
  const subject = words.subject(p.subject, when(p.daysLeft));
  return renderEmail(
    {
      subject,
      heading: subject,
      paragraphs: [`The date is ${longDate(p.on)}.`, words.advice],
      action: { label: "Open permits", path: "/app/books/permits" },
      reason: "you are an owner of the league",
    },
    ctx,
  );
});
