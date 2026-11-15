import { z } from "zod";
import { fill } from "@/i18n/catalog";
import { defineTemplate } from "./define";
import { emailWords, renderEmail } from "./layout";

/** What a missing-score reminder carries in the outbox. */
export const scoreReminderPayload = z.object({
  gameId: z.string().min(1),
  /** "Aces vs Bees". */
  teams: z.string().min(1),
  /** When and where, as the league writes it: "Sun, Sep 13, 7:00 PM, Field 2". */
  when: z.string().min(1),
  role: z.enum(["referee", "captain"]),
});

export type ScoreReminderPayload = z.infer<typeof scoreReminderPayload>;

export const scoreReminderEmail = defineTemplate(
  scoreReminderPayload,
  (p, ctx) => {
    const w = emailWords(ctx).w.scoreReminder;
    const vars = { teams: p.teams, when: p.when };
    const ref = p.role === "referee";
    return renderEmail(
      {
        subject: fill(w.subject, vars),
        heading: w.heading,
        paragraphs: [fill(w.lead, vars), ref ? w.referee : w.captain],
        action: { label: w.action, path: `/app/games/${p.gameId}/score` },
        reason: ref ? w.refereeReason : w.captainReason,
      },
      ctx,
    );
  },
);
