import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/** A reported score waiting for a captain to confirm or dispute it. */
export const scoreConfirmationPayload = z.object({
  gameId: z.string().min(1),
  /** "Aces vs Bees". */
  teams: z.string().min(1),
  /** When and where, as the league writes it: "Sun, Sep 13, 7:00 PM, Field 2". */
  when: z.string().min(1),
  /** Who reported it: "The ref", or the other team's name. */
  reportedBy: z.string().min(1),
  /** The score as reported: "Aces 7, Bees 5". */
  result: z.string().min(1),
});

export type ScoreConfirmationPayload = z.infer<typeof scoreConfirmationPayload>;

/** A reported score as players read it. */
export function describeScore(
  r: {
    outcome: "normal" | "called" | "forfeit_a" | "forfeit_b";
    scoreA: number;
    scoreB: number;
    inningsPlayed: number | null;
  },
  teamA: string,
  teamB: string,
): string {
  if (r.outcome === "forfeit_a") return `${teamA} forfeited`;
  if (r.outcome === "forfeit_b") return `${teamB} forfeited`;
  const called =
    r.outcome === "called" ? ` (called after ${r.inningsPlayed} innings)` : "";
  return `${teamA} ${r.scoreA}, ${teamB} ${r.scoreB}${called}`;
}

export const scoreConfirmationEmail = defineTemplate(
  scoreConfirmationPayload,
  (p, ctx) =>
    renderEmail(
      {
        subject: `Confirm the score: ${p.result}`,
        heading: "Is this score right?",
        paragraphs: [
          `${p.reportedBy} reported ${p.result} for ${p.teams} (${p.when}).`,
          "Confirm it, or dispute it if it's wrong. If nobody disputes it, it becomes final after 24 hours.",
        ],
        action: {
          label: "Confirm or dispute",
          path: `/app/games/${p.gameId}/score`,
        },
        reason: "you captain one of the teams in this game",
      },
      ctx,
    ),
);
