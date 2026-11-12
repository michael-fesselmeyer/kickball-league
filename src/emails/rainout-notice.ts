import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/** What a rain-out notice carries in the outbox: one player's game and its makeup. */
export const rainoutNoticePayload = z.object({
  seasonName: z.string().min(1),
  seasonSlug: z.string().min(1),
  /** "Aces vs Bees". */
  teams: z.string().min(1),
  /** When and where the game was, as the league writes it: "Sun, Sep 13, 7:00 PM, Field 2". */
  was: z.string().min(1),
  /** When and where the makeup is, or null while it has no slot yet. */
  makeup: z.string().min(1).nullable(),
});

export type RainoutNoticePayload = z.infer<typeof rainoutNoticePayload>;

export const rainoutNoticeEmail = defineTemplate(
  rainoutNoticePayload,
  (p, ctx) =>
    renderEmail(
      {
        subject: p.makeup
          ? `Rained out: ${p.teams} moves to ${p.makeup}`
          : `Rained out: ${p.teams} is postponed`,
        heading: p.makeup
          ? "Your game has a new time"
          : "Your game is postponed",
        paragraphs: [
          `${p.teams} (${p.was}) is rained out.`,
          p.makeup
            ? `The makeup is ${p.makeup}. Tell your captain if you can't make it.`
            : "It has no makeup time yet. The new time will be on the schedule as soon as the league sets it.",
        ],
        action: {
          label: "See the schedule",
          path: `/app/seasons/${p.seasonSlug}`,
        },
        reason: `you play in this game in ${p.seasonName}`,
      },
      ctx,
    ),
);
