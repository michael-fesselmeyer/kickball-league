import { z } from "zod";
import { fill } from "@/i18n/catalog";
import { defineTemplate } from "./define";
import { emailWords, renderEmail } from "./layout";

/** The one message a giveaway winner gets: what they won and where. */
export const giveawayWinPayload = z.object({
  prize: z.string().min(1),
  donatedBy: z.string().nullable(),
  eventTitle: z.string().min(1),
  eventSlug: z.string().min(1),
});

export type GiveawayWinPayload = z.infer<typeof giveawayWinPayload>;

export const giveawayWinEmail = defineTemplate(giveawayWinPayload, (p, ctx) => {
  const w = emailWords(ctx).w.giveaway;
  const vars = {
    event: p.eventTitle,
    prize: p.prize,
    donor: p.donatedBy ?? "",
  };
  return renderEmail(
    {
      subject: fill(w.subject, vars),
      heading: w.heading,
      paragraphs: [fill(p.donatedBy ? w.leadFrom : w.lead, vars), w.claim],
      action: {
        label: w.action,
        path: `/app/events/${p.eventSlug}/giveaway`,
      },
      reason: fill(w.reason, vars),
    },
    ctx,
  );
});
