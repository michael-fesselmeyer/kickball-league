import { z } from "zod";
import { fill } from "@/i18n/catalog";
import { defineTemplate } from "./define";
import { emailWords, renderEmail } from "./layout";

/**
 * For a team's captains: a player marked a week away, and the players left
 * that week can't field a full lineup. Sent once per team, week and
 * captain (src/db/queries/away.ts).
 */
export const awayShortPayload = z.object({
  seasonName: z.string().min(1),
  seasonSlug: z.string().min(1),
  team: z.string().min(1),
  /** "Oct 5 – Oct 11". */
  week: z.string().min(1),
  /** Who marked the week away, as "Jo S.". */
  player: z.string().min(1),
  available: z.number().int().min(0),
  /** The fielding check for who is left, in plain words. */
  fielding: z.string().min(1),
  games: z
    .array(z.object({ opponent: z.string().min(1), when: z.string().min(1) }))
    .min(1),
  /** The week's first game, for the sub request link. */
  gameId: z.string().uuid(),
  /** Sub requests are open for it (not a playoff game). */
  subsOpen: z.boolean(),
});

export type AwayShortPayload = z.infer<typeof awayShortPayload>;

export const awayShortEmail = defineTemplate(awayShortPayload, (p, ctx) => {
  const w = emailWords(ctx).w.awayShort;
  const vars = { team: p.team, week: p.week, season: p.seasonName };
  return renderEmail(
    {
      subject: fill(w.subject, vars),
      heading: fill(w.heading, vars),
      paragraphs: [
        fill(w.lead, {
          player: p.player,
          available: p.available,
          games: p.games
            .map((g) => fill(w.game, { when: g.when, opponent: g.opponent }))
            .join(w.and),
        }),
        p.fielding,
        p.subsOpen ? w.subsOpen : w.subsClosed,
      ],
      action: p.subsOpen
        ? {
            label: w.askSub,
            path: `/app/seasons/${p.seasonSlug}/team/subs?game=${p.gameId}#ask`,
          }
        : {
            label: emailWords(ctx).w.common.seeTeam,
            path: `/app/seasons/${p.seasonSlug}/team#game-${p.gameId}`,
          },
      reason: fill(w.reason, vars),
    },
    ctx,
  );
});
