import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

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
  const what = p.team ? `${p.description}, ${p.team} colors` : p.description;
  switch (p.kind) {
    case "receipt":
      return renderEmail(
        {
          subject: `Your order: ${p.description}`,
          heading: "Thanks for your order",
          paragraphs: [
            `Your order for ${what} is in.`,
            ...(p.paid ? [`You paid ${p.paid}.`] : []),
            "We'll let you know when it's ready.",
          ],
          action: { label: "See your orders", path: PAGE },
          reason: "you ordered from the league shop",
        },
        ctx,
      );
    case "fulfilled":
      return renderEmail(
        {
          subject: `Ready: ${p.description}`,
          heading: "Your order is ready",
          paragraphs: [
            `Your ${what} is ready. Look for it from the league at your next game.`,
          ],
          action: { label: "See your orders", path: PAGE },
          reason: "you ordered from the league shop",
        },
        ctx,
      );
    case "refunded":
      return renderEmail(
        {
          subject: `Refunded: ${p.description}`,
          heading: "Your order was refunded",
          paragraphs: [
            `The league refunded your order for ${what}.`,
            ...(p.returned
              ? [
                  `${p.returned}. A card refund usually shows up within 5 to 10 days.`,
                ]
              : []),
          ],
          action: { label: "See your orders", path: PAGE },
          reason: "you ordered from the league shop",
        },
        ctx,
      );
  }
});
