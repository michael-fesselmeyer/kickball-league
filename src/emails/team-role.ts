import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

const about = {
  seasonName: z.string().min(1),
  seasonSlug: z.string().min(1),
  team: z.string().min(1),
};

/**
 * Changes to who leads a team (ADR 0042): the captaincy offered to a
 * teammate (kind `captain_handoff`, urgent: it waits on their answer), and,
 * as `team_role`, the answer for the captain who offered it and a teammate
 * made a co-captain or a player again. A withdrawn offer sends nothing.
 */
export const teamRolePayload = z.discriminatedUnion("kind", [
  z.object({
    ...about,
    kind: z.literal("offered"),
    /** The captain offering, as "Jo S.". */
    captain: z.string().min(1),
  }),
  z.object({
    ...about,
    kind: z.literal("accepted"),
    /** The new captain, as "Jo S.". */
    player: z.string().min(1),
  }),
  z.object({
    ...about,
    kind: z.literal("declined"),
    player: z.string().min(1),
  }),
  z.object({ ...about, kind: z.literal("co_captain") }),
  z.object({ ...about, kind: z.literal("player") }),
]);

export type TeamRolePayload = z.infer<typeof teamRolePayload>;

export const teamRoleEmail = defineTemplate(teamRolePayload, (p, ctx) => {
  const team = { path: `/app/seasons/${p.seasonSlug}/team` };
  switch (p.kind) {
    case "offered":
      return renderEmail(
        {
          subject: `${p.captain} asked you to captain ${p.team}`,
          heading: `Captain ${p.team}?`,
          paragraphs: [
            `${p.captain} would like you to take over as captain of ${p.team} for ${p.seasonName}.`,
            "Nothing changes until you say yes. As captain you run the roster, invites, payments and co-captains; they stay on as a co-captain.",
          ],
          action: { label: "Answer on your team page", ...team },
          reason: `you play for ${p.team}`,
        },
        ctx,
      );
    case "accepted":
      return renderEmail(
        {
          subject: `${p.player} is now captain of ${p.team}`,
          heading: "Your team has a new captain",
          paragraphs: [
            `${p.player} accepted: they captain ${p.team} for ${p.seasonName} from now on.`,
            "You stay on as a co-captain, with the team's lineups, sub requests and scores. The new captain can change that.",
          ],
          action: { label: "See your team", ...team },
          reason: `you offered ${p.player} the captaincy`,
        },
        ctx,
      );
    case "declined":
      return renderEmail(
        {
          subject: `${p.player} won't take over ${p.team}`,
          heading: "You're still the captain",
          paragraphs: [
            `${p.player} said no to captaining ${p.team}, so you stay captain for ${p.seasonName}.`,
            "You can offer it to another teammate from your team page.",
          ],
          action: { label: "See your team", ...team },
          reason: `you offered ${p.player} the captaincy`,
        },
        ctx,
      );
    case "co_captain":
      return renderEmail(
        {
          subject: `You're a co-captain of ${p.team}`,
          heading: "You're a co-captain",
          paragraphs: [
            `You now help run ${p.team} for ${p.seasonName}: set kicking orders, ask for subs, enter and confirm scores, and see who has paid.`,
            "You can step down from your team page whenever you like.",
          ],
          action: { label: "See your team", ...team },
          reason: `you play for ${p.team}`,
        },
        ctx,
      );
    case "player":
      return renderEmail(
        {
          subject: `You're no longer a co-captain of ${p.team}`,
          heading: "Back to playing",
          paragraphs: [
            `You're on ${p.team} for ${p.seasonName} as a player now, without the co-captain's tools.`,
          ],
          action: { label: "See your team", ...team },
          reason: `you play for ${p.team}`,
        },
        ctx,
      );
  }
});
