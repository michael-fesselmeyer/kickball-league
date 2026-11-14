import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/** The one message each player gets when their season's card is ready. */
export const seasonCardPayload = z.object({
  seasonName: z.string().min(1),
  seasonSlug: z.string().min(1),
});

export type SeasonCardPayload = z.infer<typeof seasonCardPayload>;

export const seasonCardEmail = defineTemplate(seasonCardPayload, (p, ctx) =>
  renderEmail(
    {
      subject: `Your ${p.seasonName} season in kickball`,
      heading: "Your season in kickball",
      paragraphs: [
        `${p.seasonName} is in the books. Your card has your games, your team's runs and record, your awards and your best game.`,
        "Only you can see it until you choose to share its link.",
      ],
      action: {
        label: "See your season",
        path: `/app/seasons/${p.seasonSlug}/card`,
      },
      reason: `you played in ${p.seasonName}`,
    },
    ctx,
  ),
);
