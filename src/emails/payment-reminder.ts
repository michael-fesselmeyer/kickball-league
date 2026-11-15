import { z } from "zod";
import { fill, plural } from "@/i18n/catalog";
import { defineTemplate } from "./define";
import { emailWords, renderEmail } from "./layout";

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

export const paymentReminderEmail = defineTemplate(
  paymentReminderPayload,
  (p, ctx) => {
    const { locale, w: all } = emailWords(ctx);
    const w = all.payment;
    const when =
      p.daysLeft === 0
        ? w.today
        : p.daysLeft === 1
          ? w.tomorrow
          : plural(locale, w.inDays, p.daysLeft);
    const vars = { season: p.seasonName, deadline: p.deadline, when };
    return renderEmail(
      {
        subject: fill(w.subject, vars),
        heading: fill(w.heading, vars),
        paragraphs: [
          fill(w.lead, vars),
          p.needsWaiver ? w.waiverFirst : w.byCard,
        ],
        action: { label: w.action, path: `/app/seasons/${p.seasonSlug}` },
        reason: fill(w.reason, vars),
      },
      ctx,
    );
  },
);
