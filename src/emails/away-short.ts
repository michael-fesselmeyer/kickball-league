import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

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

export const awayShortEmail = defineTemplate(awayShortPayload, (p, ctx) =>
  renderEmail(
    {
      subject: `${p.team} may be short the week of ${p.week}`,
      heading: `Short the week of ${p.week}?`,
      paragraphs: [
        `${p.player} will be away that week, so ${p.available} of your players are available for ${p.games.map((g) => `${g.when} vs ${g.opponent}`).join(" and ")}.`,
        p.fielding,
        p.subsOpen
          ? "Ask for a sub now and players who are free that night will hear about it."
          : "Sub requests aren't open for playoff games; check with the league.",
      ],
      action: p.subsOpen
        ? {
            label: "Ask for a sub",
            path: `/app/seasons/${p.seasonSlug}/team/subs?game=${p.gameId}#ask`,
          }
        : {
            label: "See your team",
            path: `/app/seasons/${p.seasonSlug}/team#game-${p.gameId}`,
          },
      reason: `you captain ${p.team} in ${p.seasonName}`,
    },
    ctx,
  ),
);
