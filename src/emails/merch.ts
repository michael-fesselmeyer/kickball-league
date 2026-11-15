import { z } from "zod";
import { fill } from "@/i18n/catalog";
import { defineTemplate } from "./define";
import { emailWords, renderEmail } from "./layout";

/**
 * Merch order emails: the receipt (urgent, it is about money), and the
 * notices that an order is ready or was refunded (non-urgent). Amounts
 * arrive already written out.
 */
export const merchPayload = z.object({
  kind: z.enum(["receipt", "fulfilled", "refunded"]),
  /** "League shirt (M) × 2". */
  description: z.string().min(1),
  /** A team jersey's team, such as "Kick Ash". */
  team: z.string().optional(),
  /** "$15 on your card and $5 of league credit". */
  paid: z.string().optional(),
  /** "$15 back to your card and $5 back to your league credit". */
  returned: z.string().optional(),
});

export type MerchPayload = z.infer<typeof merchPayload>;

const PAGE = "/app/shop";

export const merchEmail = defineTemplate(merchPayload, (p, ctx) => {
  const { w: all } = emailWords(ctx);
  const w = all.merch;
  const what = p.team
    ? fill(w.teamColors, { description: p.description, team: p.team })
    : p.description;
  const vars = { description: p.description, what };
  const action = { label: all.common.seeOrders, path: PAGE };
  switch (p.kind) {
    case "receipt":
      return renderEmail(
        {
          subject: fill(w.receiptSubject, vars),
          heading: w.receiptHeading,
          paragraphs: [
            fill(w.receiptLead, vars),
            ...(p.paid ? [fill(all.common.youPaid, { paid: p.paid })] : []),
            w.letYouKnow,
          ],
          action,
          reason: w.reason,
        },
        ctx,
      );
    case "fulfilled":
      return renderEmail(
        {
          subject: fill(w.readySubject, vars),
          heading: w.readyHeading,
          paragraphs: [fill(w.readyLead, vars)],
          action,
          reason: w.reason,
        },
        ctx,
      );
    case "refunded":
      return renderEmail(
        {
          subject: fill(w.refundedSubject, vars),
          heading: w.refundedHeading,
          paragraphs: [
            fill(w.refundedLead, vars),
            ...(p.returned
              ? [fill(all.common.cardRefund, { returned: p.returned })]
              : []),
          ],
          action,
          reason: w.reason,
        },
        ctx,
      );
  }
});
