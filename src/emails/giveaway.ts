import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/** The one message a giveaway winner gets: what they won and where. */
export const giveawayWinPayload = z.object({
  prize: z.string().min(1),
  donatedBy: z.string().nullable(),
  eventTitle: z.string().min(1),
  eventSlug: z.string().min(1),
});

export type GiveawayWinPayload = z.infer<typeof giveawayWinPayload>;

export const giveawayWinEmail = defineTemplate(giveawayWinPayload, (p, ctx) =>
  renderEmail(
    {
      subject: `You won the ${p.eventTitle} giveaway`,
      heading: "You won!",
      paragraphs: [
        `Your name came up in the giveaway at ${p.eventTitle}: ${p.prize}${p.donatedBy ? `, from ${p.donatedBy}` : ""}.`,
        "The giveaway's page says how to claim it. The draw was random, from everyone who checked in.",
      ],
      action: {
        label: "See your prize",
        path: `/app/events/${p.eventSlug}/giveaway`,
      },
      reason: `you entered the giveaway at ${p.eventTitle}`,
    },
    ctx,
  ),
);
