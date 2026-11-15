import { z } from "zod";
import { fill } from "@/i18n/catalog";
import { defineTemplate } from "./define";
import { emailWords, renderEmail } from "./layout";

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
  (p, ctx) => {
    const w = emailWords(ctx).w.rainout;
    const vars = {
      teams: p.teams,
      was: p.was,
      makeup: p.makeup ?? "",
      season: p.seasonName,
    };
    return renderEmail(
      {
        subject: fill(p.makeup ? w.movesSubject : w.postponedSubject, vars),
        heading: p.makeup ? w.newTimeHeading : w.postponedHeading,
        paragraphs: [
          fill(w.lead, vars),
          p.makeup ? fill(w.makeup, vars) : w.noMakeup,
        ],
        action: { label: w.action, path: `/app/seasons/${p.seasonSlug}` },
        reason: fill(w.reason, vars),
      },
      ctx,
    );
  },
);
