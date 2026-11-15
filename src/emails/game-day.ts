import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/**
 * Messages about a game day's status (issue #383): a player's game starts
 * late, is called off or is back on; a weather watch for players who asked
 * for one; and the admins' reminder when a decision time passes.
 */

const reason = z.string().min(1).max(120).nullable();

export const gameDayChangePayload = z.object({
  seasonName: z.string().min(1),
  gameId: z.uuid(),
  /** "Aces vs Bees". */
  teams: z.string().min(1),
  /** "Tue, Sep 15". */
  day: z.string().min(1),
  /** The scheduled start, "6:00 PM". */
  was: z.string().min(1),
  kind: z.enum(["delayed", "off", "back_on"]),
  /** Delayed only: "7:30 PM". */
  newStart: z.string().min(1).nullable(),
  reason,
});

export type GameDayChangePayload = z.infer<typeof gameDayChangePayload>;

export const gameDayChangeEmail = defineTemplate(
  gameDayChangePayload,
  (p, ctx) => {
    const why = p.reason ? ` ${p.reason}.` : "";
    const content =
      p.kind === "delayed"
        ? {
            subject: `Starts late: ${p.teams}, ${p.day}`,
            heading: `Your game now starts at ${p.newStart ?? "a later time"}`,
            lead: `${p.teams} on ${p.day} was due at ${p.was} and now starts at ${p.newStart ?? "a later time"}.${why}`,
          }
        : p.kind === "off"
          ? {
              subject: `Off: ${p.teams}, ${p.day}`,
              heading: "Your game is off",
              lead: `${p.teams} on ${p.day} at ${p.was} is off.${why} You'll hear its makeup time once the league reschedules it.`,
            }
          : {
              subject: `Back on: ${p.teams}, ${p.day}`,
              heading: "Your game is back on",
              lead: `${p.teams} on ${p.day} is back on at ${p.was}.${why}`,
            };
    return renderEmail(
      {
        subject: content.subject,
        heading: content.heading,
        paragraphs: [content.lead],
        action: { label: "See the game", path: `/games/${p.gameId}` },
        reason: `you play in ${p.seasonName}`,
      },
      ctx,
    );
  },
);

export const gameDayWatchPayload = z.object({
  seasonName: z.string().min(1),
  gameId: z.uuid(),
  teams: z.string().min(1),
  day: z.string().min(1),
  /** "3:00 PM". */
  decideBy: z.string().min(1),
  reason,
});

export type GameDayWatchPayload = z.infer<typeof gameDayWatchPayload>;

export const gameDayWatchEmail = defineTemplate(gameDayWatchPayload, (p, ctx) =>
  renderEmail(
    {
      subject: `Watching the weather: decision by ${p.decideBy}, ${p.day}`,
      heading: `We'll decide by ${p.decideBy}`,
      paragraphs: [
        `The league is watching the weather for ${p.teams} on ${p.day} and will decide by ${p.decideBy} whether games are on.${p.reason ? ` ${p.reason}.` : ""}`,
        "If your game starts late or is called off, you'll get another message.",
      ],
      action: { label: "See the game", path: `/games/${p.gameId}` },
      reason: "you asked for weather watches before your games",
    },
    ctx,
  ),
);

export const gameDayDecidePayload = z.object({
  seasonName: z.string().min(1),
  seasonSlug: z.string().min(1),
  date: z.iso.date(),
  day: z.string().min(1),
  decideBy: z.string().min(1),
});

export type GameDayDecidePayload = z.infer<typeof gameDayDecidePayload>;

export const gameDayDecideEmail = defineTemplate(
  gameDayDecidePayload,
  (p, ctx) =>
    renderEmail(
      {
        subject: `Decision time passed: ${p.seasonName}, ${p.day}`,
        heading: "Players are waiting for the call",
        paragraphs: [
          `${p.seasonName} said it would decide by ${p.decideBy} whether ${p.day}'s games are on, and the status still says it's watching the weather.`,
          "Set it to On, Delayed or Off so players know.",
        ],
        action: {
          label: "Set the game-day status",
          path: `/app/admin/seasons/${p.seasonSlug}/status?date=${p.date}`,
        },
        reason: "you are a league admin",
      },
      ctx,
    ),
);
