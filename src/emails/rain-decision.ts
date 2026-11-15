import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/**
 * The decision-time alert (ADR 0057): a few hours before a game day's first
 * pitch, the people who can confirm a rain-out get the decision card's
 * summary and a link to the rain-out screen. Nothing is cancelled.
 */
export const rainDecisionPayload = z.object({
  seasonName: z.string().min(1),
  seasonSlug: z.string().min(1),
  /** The game day as YYYY-MM-DD, which the rain-out screen preselects. */
  date: z.iso.date(),
  /** "Sun, Sep 13". */
  day: z.string().min(1),
  /** "1:00 PM". */
  firstPitch: z.string().min(1),
  games: z.number().int().positive(),
  level: z.enum(["watch", "likely"]),
  /** The decision card's sentence: "Likely unplayable: …". */
  summary: z.string().min(1).max(600),
});

export type RainDecisionPayload = z.infer<typeof rainDecisionPayload>;

export const rainDecisionEmail = defineTemplate(
  rainDecisionPayload,
  (p, ctx) => {
    const games = p.games === 1 ? "1 game" : `${p.games} games`;
    return renderEmail(
      {
        subject:
          p.level === "likely"
            ? `Rain-out call needed today: ${p.seasonName}`
            : `Check the weather before ${p.firstPitch}: ${p.seasonName}`,
        heading:
          p.level === "likely"
            ? `Time to make the rain-out call for ${p.day}`
            : `Keep an eye on ${p.day}`,
        paragraphs: [
          `${p.seasonName} has ${games} today, from ${p.firstPitch}.`,
          p.summary,
          "Nothing is cancelled unless someone confirms the rain-out. The screen shows the hour-by-hour forecast, the rain already on the ground and the makeups before anything is sent to players.",
        ],
        action: {
          label: "Open the rain-out screen",
          path: `/app/admin/seasons/${p.seasonSlug}/rainout?date=${p.date}`,
        },
        reason: "you can confirm rain-outs and games are on today",
      },
      ctx,
    );
  },
);
