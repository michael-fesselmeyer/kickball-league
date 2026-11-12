import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/** What a rain alert to an admin carries in the outbox: one game day's risk. */
export const rainAlertPayload = z.object({
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
  /** The highest chance of rain in any game hour, 0 to 100. */
  peakChance: z.number().int().min(0).max(100),
  thunder: z.boolean(),
});

export type RainAlertPayload = z.infer<typeof rainAlertPayload>;

export const rainAlertEmail = defineTemplate(rainAlertPayload, (p, ctx) => {
  const games = p.games === 1 ? "1 game" : `${p.games} games`;
  const outlook = [
    `Up to a ${p.peakChance}% chance of rain while games are on`,
    ...(p.thunder ? ["with thunderstorms in the forecast"] : []),
  ].join(", ");
  return renderEmail(
    {
      subject:
        p.level === "likely"
          ? `Rain likely ${p.day}: ${p.seasonName}`
          : `Rain watch ${p.day}: ${p.seasonName}`,
      heading:
        p.level === "likely"
          ? `Rain is likely on ${p.day}`
          : `Keep an eye on ${p.day}`,
      paragraphs: [
        `${p.seasonName} has ${games} on ${p.day}, from ${p.firstPitch}. ${outlook}, according to the National Weather Service.`,
        p.level === "likely"
          ? "If you call it, the rain-out screen shows the makeups before anything is sent to players."
          : "Nothing needs doing yet. If the forecast gets worse, you will get a second alert.",
      ],
      action: {
        label: "Open the rain-out screen",
        path: `/app/admin/seasons/${p.seasonSlug}/rainout?date=${p.date}`,
      },
      reason: "you are a league admin and games are coming up",
    },
    ctx,
  );
});
