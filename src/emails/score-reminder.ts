import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

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
  (p, ctx) =>
    renderEmail(
      {
        subject: `Score needed: ${p.teams}`,
        heading: "What was the final score?",
        paragraphs: [
          `${p.teams} (${p.when}) has no score yet.`,
          p.role === "referee"
            ? "As the ref, enter it now so the standings update tonight. It takes a few seconds."
            : "Your ref has not entered it. Either captain can, and the other team confirms.",
        ],
        action: {
          label: "Enter the score",
          path: `/app/games/${p.gameId}/score`,
        },
        reason:
          p.role === "referee"
            ? "you refereed this game"
            : "you captain one of the teams in this game",
      },
      ctx,
    ),
);
