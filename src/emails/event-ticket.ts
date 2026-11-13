import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/**
 * Ticket emails for a ticketed event: the receipt, a refund, and an offer
 * to the next person on the waitlist when a spot opens. Amounts and times
 * arrive already written out in the league's time zone.
 */
export const eventTicketPayload = z.object({
  kind: z.enum(["receipt", "refunded", "offered"]),
  title: z.string().min(1),
  slug: z.string().min(1),
  /** "Fri, Nov 20, 7:00 – 10:00 PM". */
  when: z.string().min(1),
  place: z.string().nullable(),
  /** The check-in code, as "K7M 4QX". */
  code: z.string().optional(),
  /** "$15 on your card and $5 of league credit", or "$10 of league credit". */
  paid: z.string().optional(),
  /** "$15 back to your card and $5 back to your league credit". */
  returned: z.string().optional(),
  /** When an offer runs out, such as "Thu, Nov 19, 7:00 PM". */
  expires: z.string().optional(),
});

export type EventTicketPayload = z.infer<typeof eventTicketPayload>;

export const eventTicketEmail = defineTemplate(eventTicketPayload, (p, ctx) => {
  const where = p.place ? `${p.when}, ${p.place}` : p.when;
  const page = `/app/events/${p.slug}`;
  switch (p.kind) {
    case "receipt":
      return renderEmail(
        {
          subject: `Your ticket: ${p.title}`,
          heading: `You're going to ${p.title}`,
          paragraphs: [
            `Your ticket for ${p.title} (${where}) is confirmed.`,
            ...(p.paid ? [`You paid ${p.paid}.`] : []),
            ...(p.code
              ? [`Your check-in code is ${p.code}. Show it at the door.`]
              : []),
          ],
          action: { label: "See your ticket", path: page },
          reason: "you bought a ticket",
        },
        ctx,
      );
    case "refunded":
      return renderEmail(
        {
          subject: `Refunded: ${p.title}`,
          heading: `Your ticket for ${p.title} is refunded`,
          paragraphs: [
            `The league refunded your ticket for ${p.title} (${where}), so it no longer gets you in.`,
            ...(p.returned
              ? [
                  `${p.returned}. A card refund usually shows up within 5 to 10 days.`,
                ]
              : []),
          ],
          action: { label: "See the event", path: page },
          reason: "you bought a ticket",
        },
        ctx,
      );
    case "offered":
      return renderEmail(
        {
          subject: `A spot opened: ${p.title}`,
          heading: `A spot opened up for ${p.title}`,
          paragraphs: [
            `You were on the waitlist for ${p.title} (${where}), and a spot is now held for you.`,
            `Buy your ticket${p.expires ? ` by ${p.expires}` : ""}. After that it goes to the next person in line.`,
          ],
          action: { label: "Buy your ticket", path: page },
          reason: "you joined this event's waitlist",
        },
        ctx,
      );
  }
});
