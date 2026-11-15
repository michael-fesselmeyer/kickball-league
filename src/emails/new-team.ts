import { z } from "zod";
import { fill } from "@/i18n/catalog";
import { defineTemplate } from "./define";
import { emailWords, renderEmail } from "./layout";

const about = {
  seasonName: z.string().min(1),
  seasonSlug: z.string().min(1),
  /** The new team's name. */
  team: z.string().min(1),
};

/**
 * The league's answer to a request to start a team, for the requester, and
 * the notice to the captain of the team they left.
 */
export const newTeamPayload = z.discriminatedUnion("kind", [
  z.object({ ...about, kind: z.literal("approved") }),
  z.object({
    ...about,
    kind: z.literal("declined"),
    reason: z.string().nullable(),
  }),
  z.object({
    ...about,
    kind: z.literal("player_left"),
    /** The player who left, as "Jo S.". */
    player: z.string().min(1),
    /** The team they left. */
    leftTeam: z.string().min(1),
  }),
]);

export type NewTeamPayload = z.infer<typeof newTeamPayload>;

export const newTeamEmail = defineTemplate(newTeamPayload, (p, ctx) => {
  const { w: all } = emailWords(ctx);
  const w = all.newTeam;
  const vars = { team: p.team, season: p.seasonName };
  switch (p.kind) {
    case "approved":
      return renderEmail(
        {
          subject: fill(w.approvedSubject, vars),
          heading: w.approvedHeading,
          paragraphs: [fill(w.approvedLead, vars), w.approvedMore],
          action: {
            label: w.invite,
            path: `/app/seasons/${p.seasonSlug}/team`,
          },
          reason: fill(w.askedReason, vars),
        },
        ctx,
      );
    case "declined":
      return renderEmail(
        {
          subject: fill(w.declinedSubject, vars),
          heading: w.declinedHeading,
          paragraphs: [
            fill(w.declinedLead, vars),
            ...(p.reason
              ? [fill(all.common.fromLeague, { text: p.reason })]
              : []),
            w.declinedMore,
          ],
          action: {
            label: w.seeSeason,
            path: `/app/seasons/${p.seasonSlug}`,
          },
          reason: fill(w.askedReason, vars),
        },
        ctx,
      );
    case "player_left": {
      const left = { ...vars, player: p.player, left: p.leftTeam };
      return renderEmail(
        {
          subject: fill(w.leftSubject, left),
          heading: fill(w.leftHeading, left),
          paragraphs: [fill(w.leftLead, left), w.leftMore],
          action: {
            label: w.seeRoster,
            path: `/app/seasons/${p.seasonSlug}/team`,
          },
          reason: fill(w.captainReason, { team: p.leftTeam }),
        },
        ctx,
      );
    }
  }
});
