import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/** What a payment reminder carries in the outbox. */
export const paymentReminderPayload = z.object({
  seasonName: z.string().min(1),
  seasonSlug: z.string().min(1),
  /** The deadline as the league writes it, such as "Friday, September 11 at 11:59 PM". */
  deadline: z.string().min(1),
  daysLeft: z.number().int().min(0),
  /** Still needs to sign the season waiver before paying. */
  needsWaiver: z.boolean(),
});

export type PaymentReminderPayload = z.infer<typeof paymentReminderPayload>;

const when = (days: number) =>
  days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;

export const paymentReminderEmail = defineTemplate(
  paymentReminderPayload,
  (p, ctx) =>
    renderEmail(
      {
        subject: `Your ${p.seasonName} fee is due ${when(p.daysLeft)}`,
        heading: `Your spot needs paying ${when(p.daysLeft)}`,
        paragraphs: [
          `The payment deadline for ${p.seasonName} is ${p.deadline}. Pay before then to keep your spot.`,
          p.needsWaiver
            ? "Sign the season waiver first; the payment step comes right after."
            : "It takes a minute by card. If you already paid your captain in cash or Venmo, ask them to mark it in the app.",
        ],
        action: { label: "Pay now", path: `/app/seasons/${p.seasonSlug}` },
        reason: `you registered for ${p.seasonName} and have not paid yet`,
      },
      ctx,
    ),
);
