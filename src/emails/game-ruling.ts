import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/**
 * An admin's written ruling on a game: a forfeit, a settled dispute, or a
 * correction or reversal of a result. Sent to both teams' captains and the
 * game's ref.
 */
export const gameRulingPayload = z.object({
  gameId: z.string().min(1),
  /** "Aces vs Bees". */
  teams: z.string().min(1),
  /** When and where, as the league writes it: "Sun, Sep 13, 7:00 PM, Field 2". */
  when: z.string().min(1),
  kind: z.enum(["forfeit", "forfeit_reversed", "ruling"]),
  /** The result now: "Aces 7, Bees 5" or "Bees forfeited". */
  result: z.string().min(1),
  /** The result it replaces, when there was one. */
  previously: z.string().min(1).optional(),
  /** The admin's reason, as written. */
  reason: z.string().min(1),
});

export type GameRulingPayload = z.infer<typeof gameRulingPayload>;

const HEADINGS = {
  forfeit: "A forfeit was recorded",
  forfeit_reversed: "A forfeit was reversed",
  ruling: "A ruling was made",
} as const;

export const gameRulingEmail = defineTemplate(gameRulingPayload, (p, ctx) =>
  renderEmail(
    {
      subject: `Ruling: ${p.teams}`,
      heading: HEADINGS[p.kind],
      paragraphs: [
        `An admin ruled on ${p.teams} (${p.when}): ${p.result}.`,
        ...(p.previously ? [`It replaces: ${p.previously}.`] : []),
        `Reason: “${p.reason}”`,
      ],
      action: {
        label: "See the ruling",
        path: `/app/games/${p.gameId}/score`,
      },
      reason: "you captain or referee one of the teams in this game",
    },
    ctx,
  ),
);
