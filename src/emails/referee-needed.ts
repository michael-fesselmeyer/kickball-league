import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/**
 * A game starting within a day has no ref (issue #389): sent to each of the
 * league's refs who is free then. The first to tap "Take it" gets it.
 */
export const refereeNeededPayload = z.object({
  gameId: z.uuid(),
  seasonName: z.string().min(1),
  /** "Aces vs Bees". */
  teams: z.string().min(1),
  /** When and where: "Sun, Sep 13, 7:00 PM, Field 2". */
  when: z.string().min(1),
  /** Its ref dropped out, rather than it never having one. */
  dropped: z.boolean(),
});

export type RefereeNeededPayload = z.infer<typeof refereeNeededPayload>;

export const refereeNeededEmail = defineTemplate(
  refereeNeededPayload,
  (p, ctx) =>
    renderEmail(
      {
        subject: `Ref needed: ${p.teams}, ${p.when}`,
        heading: "Can you ref this game?",
        paragraphs: [
          p.dropped
            ? `${p.teams}, ${p.when}, lost its ref.`
            : `${p.teams}, ${p.when}, has no ref yet.`,
          'The first ref to tap "Take it" gets the game. If someone beat you to it, the page will say so.',
        ],
        action: { label: "Take it", path: `/app/referee/take/${p.gameId}` },
        reason: `you ref in ${p.seasonName} and aren't playing or reffing at that time`,
      },
      ctx,
    ),
);
