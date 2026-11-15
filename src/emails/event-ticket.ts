import { z } from "zod";
import { fill } from "@/i18n/catalog";
import { defineTemplate } from "./define";
import { emailWords, renderEmail } from "./layout";

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
  const { w: all } = emailWords(ctx);
  const w = all.ticket;
  const where = p.place ? `${p.when}, ${p.place}` : p.when;
  const vars = { title: p.title, where };
  const page = `/app/events/${p.slug}`;
  switch (p.kind) {
    case "receipt":
      return renderEmail(
        {
          subject: fill(w.receiptSubject, vars),
          heading: fill(w.receiptHeading, vars),
          paragraphs: [
            fill(w.receiptLead, vars),
            ...(p.paid ? [fill(all.common.youPaid, { paid: p.paid })] : []),
            ...(p.code ? [fill(w.code, { code: p.code })] : []),
          ],
          action: { label: w.seeTicket, path: page },
          reason: w.boughtReason,
        },
        ctx,
      );
    case "refunded":
      return renderEmail(
        {
          subject: fill(w.refundedSubject, vars),
          heading: fill(w.refundedHeading, vars),
          paragraphs: [
            fill(w.refundedLead, vars),
            ...(p.returned
              ? [fill(all.common.cardRefund, { returned: p.returned })]
              : []),
          ],
          action: { label: all.common.seeEvent, path: page },
          reason: w.boughtReason,
        },
        ctx,
      );
    case "offered":
      return renderEmail(
        {
          subject: fill(w.offeredSubject, vars),
          heading: fill(w.offeredHeading, vars),
          paragraphs: [
            fill(w.offeredLead, vars),
            p.expires ? fill(w.buyBy, { expires: p.expires }) : w.buy,
          ],
          action: { label: w.buyAction, path: page },
          reason: all.event.waitlistReason,
        },
        ctx,
      );
  }
});
