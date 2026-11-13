import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

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
  switch (p.kind) {
    case "approved":
      return renderEmail(
        {
          subject: `${p.team} is in for ${p.seasonName}`,
          heading: "Your team is approved",
          paragraphs: [
            `The league said yes: ${p.team} is set up for ${p.seasonName}, with you as captain.`,
            "Next, share your team's invite link so your players can join, and sign the waiver. The team is confirmed once it has enough players and the fee is covered.",
          ],
          action: {
            label: "Invite your players",
            path: `/app/seasons/${p.seasonSlug}/team`,
          },
          reason: `you asked to start ${p.team}`,
        },
        ctx,
      );
    case "declined":
      return renderEmail(
        {
          subject: `About your request to start ${p.team}`,
          heading: "Your new-team request",
          paragraphs: [
            `The league can't add ${p.team} to ${p.seasonName}.`,
            ...(p.reason ? [`From the league: ${p.reason}`] : []),
            "You can still join a team by invite or as a free agent.",
          ],
          action: {
            label: "See your season",
            path: `/app/seasons/${p.seasonSlug}`,
          },
          reason: `you asked to start ${p.team}`,
        },
        ctx,
      );
    case "player_left":
      return renderEmail(
        {
          subject: `${p.player} is starting a new team`,
          heading: `${p.player} left ${p.leftTeam}`,
          paragraphs: [
            `The league approved ${p.player}'s request to start ${p.team} in ${p.seasonName}, so they are no longer on your roster.`,
            "If you need another player, invite one or ask the league for a free agent.",
          ],
          action: {
            label: "See your roster",
            path: `/app/seasons/${p.seasonSlug}/team`,
          },
          reason: `you captain ${p.leftTeam}`,
        },
        ctx,
      );
  }
});
