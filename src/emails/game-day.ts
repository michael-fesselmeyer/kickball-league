import { z } from "zod";
import { fill } from "@/i18n/catalog";
import { defineTemplate } from "./define";
import { emailWords, publicPath, renderEmail } from "./layout";

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
    const { w: all } = emailWords(ctx);
    const w = all.gameDay;
    const vars = {
      teams: p.teams,
      day: p.day,
      was: p.was,
      time: p.newStart ?? w.laterTime,
      why: p.reason ? ` ${p.reason}.` : "",
    };
    const content =
      p.kind === "delayed"
        ? {
            subject: w.delayedSubject,
            heading: w.delayedHeading,
            lead: w.delayedLead,
          }
        : p.kind === "off"
          ? { subject: w.offSubject, heading: w.offHeading, lead: w.offLead }
          : {
              subject: w.backSubject,
              heading: w.backHeading,
              lead: w.backLead,
            };
    return renderEmail(
      {
        subject: fill(content.subject, vars),
        heading: fill(content.heading, vars),
        paragraphs: [fill(content.lead, vars)],
        action: {
          label: all.common.seeGame,
          path: publicPath(ctx, `/games/${p.gameId}`),
        },
        reason: fill(w.playReason, { season: p.seasonName }),
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

export const gameDayWatchEmail = defineTemplate(
  gameDayWatchPayload,
  (p, ctx) => {
    const { w: all } = emailWords(ctx);
    const w = all.gameDay;
    const vars = {
      teams: p.teams,
      day: p.day,
      time: p.decideBy,
      why: p.reason ? ` ${p.reason}.` : "",
    };
    return renderEmail(
      {
        subject: fill(w.watchSubject, vars),
        heading: fill(w.watchHeading, vars),
        paragraphs: [fill(w.watchLead, vars), w.watchMore],
        action: {
          label: all.common.seeGame,
          path: publicPath(ctx, `/games/${p.gameId}`),
        },
        reason: w.watchReason,
      },
      ctx,
    );
  },
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
