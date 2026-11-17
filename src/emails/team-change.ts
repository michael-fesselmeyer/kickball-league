import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

const about = {
  seasonName: z.string().min(1),
  seasonSlug: z.string().min(1),
  team: z.string().min(1),
};

/**
 * "Looking for a change" (ADR 0089). `move_invite` goes to the player only:
 * a recruiting team's invite, which never names the player to the team.
 * `move_accepted` goes to that team's captains once the player says yes,
 * and is the first time the team learns who they are. A "no", or no
 * answer, sends nothing.
 */
export const moveInvitePayload = z.object({
  ...about,
  /** The team's pitch, if the captain wrote one. */
  message: z.string().min(1).nullable(),
});

export const moveAcceptedPayload = z.object({
  ...about,
  /** The player who said yes, as "Jo S.". */
  player: z.string().min(1),
});

export type MoveInvitePayload = z.infer<typeof moveInvitePayload>;
export type MoveAcceptedPayload = z.infer<typeof moveAcceptedPayload>;

export const moveInviteEmail = defineTemplate(moveInvitePayload, (p, ctx) =>
  renderEmail(
    {
      subject: `${p.team} would like you next season`,
      heading: `An invite from ${p.team}`,
      paragraphs: [
        `${p.team} is looking for players for ${p.seasonName}, and you said you're open to a new team.`,
        ...(p.message ? [`From their captain: "${p.message}"`] : []),
        "They don't know who you are. If you say yes, they see your name and email so they can reach you. If you say no, or don't answer, they never find out.",
      ],
      action: { label: "Answer the invite", path: "/app/change-team" },
      reason: "you said you're open to a new team next season",
    },
    ctx,
  ),
);

export const moveAcceptedEmail = defineTemplate(moveAcceptedPayload, (p, ctx) =>
  renderEmail(
    {
      subject: `${p.player} said yes to ${p.team}`,
      heading: "Someone would like to join you",
      paragraphs: [
        `${p.player} said yes to your invite and would like to hear about playing for ${p.team} in ${p.seasonName}.`,
        "Their email is on your team page. Send them your team's invite link when you're ready.",
      ],
      action: {
        label: "See your team",
        path: `/app/seasons/${p.seasonSlug}/team?view=roster#recruiting`,
      },
      reason: `you captain ${p.team}`,
    },
    ctx,
  ),
);
