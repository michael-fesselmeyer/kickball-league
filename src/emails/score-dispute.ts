import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/** A captain disputed a reported score, so an admin has to set it. */
export const scoreDisputePayload = z.object({
  gameId: z.string().min(1),
  seasonSlug: z.string().min(1),
  /** "Aces vs Bees". */
  teams: z.string().min(1),
  /** When and where, as the league writes it: "Sun, Sep 13, 7:00 PM, Field 2". */
  when: z.string().min(1),
  /** The score as reported: "Aces 7, Bees 5". */
  result: z.string().min(1),
  /** Who reported it: "The ref", or a team's name. */
  reportedBy: z.string().min(1),
  /** The team whose captain disputed it. */
  disputedBy: z.string().min(1),
  /** The captain's note, if they left one. */
  note: z.string().optional(),
});

export type ScoreDisputePayload = z.infer<typeof scoreDisputePayload>;

export const scoreDisputeEmail = defineTemplate(scoreDisputePayload, (p, ctx) =>
  renderEmail(
    {
      subject: `Score disputed: ${p.teams}`,
      heading: "A score needs an admin",
      paragraphs: [
        `${p.disputedBy} disputed the score ${p.reportedBy} reported for ${p.teams} (${p.when}): ${p.result}.`,
        ...(p.note ? [`Their note: “${p.note}”`] : []),
        "The game stays unfinished until an admin sets the final score.",
      ],
      action: {
        label: "Set the final score",
        path: `/app/admin/seasons/${p.seasonSlug}/scores`,
      },
      reason: "you're an admin of the league",
    },
    ctx,
  ),
);
