import { z } from "zod";
import { fill } from "@/i18n/catalog";
import { defineTemplate } from "./define";
import { emailWords, renderEmail } from "./layout";

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
  (p, ctx) => {
    const w = emailWords(ctx).w.referee;
    const vars = { teams: p.teams, when: p.when, season: p.seasonName };
    return renderEmail(
      {
        subject: fill(w.subject, vars),
        heading: w.heading,
        paragraphs: [fill(p.dropped ? w.dropped : w.none, vars), w.first],
        action: { label: w.action, path: `/app/referee/take/${p.gameId}` },
        reason: fill(w.reason, vars),
      },
      ctx,
    );
  },
);
