import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/** The game a sub notice is about, as the league writes it. */
const about = {
  seasonName: z.string().min(1),
  seasonSlug: z.string().min(1),
  /** The team asking for subs. */
  team: z.string().min(1),
  /** "Aces vs Bees". */
  teams: z.string().min(1),
  /** When and where: "Sun, Sep 13, 7:00 PM, Field 2". */
  when: z.string().min(1),
};

/** A call for subs, sent to each eligible player. */
export const subRequestPayload = z.object({
  ...about,
  /** "2 subs, at least 1 woman". */
  spots: z.string().min(1),
  note: z.string().nullable(),
  freeAgent: z.boolean(),
});

export type SubRequestPayload = z.infer<typeof subRequestPayload>;

export const subRequestEmail = defineTemplate(subRequestPayload, (p, ctx) =>
  renderEmail(
    {
      subject: `${p.team} needs ${p.spots}: ${p.when}`,
      heading: `${p.team} needs a sub`,
      paragraphs: [
        `${p.teams}, ${p.when}. ${p.team} is looking for ${p.spots}.`,
        ...(p.note ? [`From the captain: ${p.note}`] : []),
        "Tap \"I'm in\" to hold a spot. The captain confirms, and you'll hear back by email.",
      ],
      action: { label: "See sub requests", path: "/app/subs" },
      reason: p.freeAgent
        ? `you are a free agent in ${p.seasonName} and free at that time`
        : `you play in ${p.seasonName} and your team is not playing at that time`,
    },
    ctx,
  ),
);

/** What happened to a claim, for the captain or for the player. */
export const subUpdatePayload = z.discriminatedUnion("kind", [
  z.object({
    ...about,
    kind: z.enum(["claimed", "withdrawn"]),
    /** The player, as "Jo S.". */
    player: z.string().min(1),
  }),
  z.object({
    ...about,
    kind: z.enum(["approved", "declined", "cancelled"]),
  }),
]);

export type SubUpdatePayload = z.infer<typeof subUpdatePayload>;

const captainPage = (slug: string) => `/app/seasons/${slug}/team/subs`;

export const subUpdateEmail = defineTemplate(subUpdatePayload, (p, ctx) => {
  switch (p.kind) {
    case "claimed":
      return renderEmail(
        {
          subject: `${p.player} wants to sub: ${p.when}`,
          heading: `${p.player} can sub`,
          paragraphs: [
            `${p.player} is holding a spot for ${p.teams}, ${p.when}.`,
            "Approve them so they know they're playing, or decline to free the spot.",
          ],
          action: {
            label: "Approve or decline",
            path: captainPage(p.seasonSlug),
          },
          reason: `you captain ${p.team}, which asked for subs`,
        },
        ctx,
      );
    case "withdrawn":
      return renderEmail(
        {
          subject: `${p.player} can't sub after all: ${p.when}`,
          heading: "A sub dropped out",
          paragraphs: [
            `${p.player} can no longer play in ${p.teams}, ${p.when}. Their spot is open again.`,
          ],
          action: {
            label: "See your request",
            path: captainPage(p.seasonSlug),
          },
          reason: `you captain ${p.team}, which asked for subs`,
        },
        ctx,
      );
    case "approved":
      return renderEmail(
        {
          subject: `You're subbing for ${p.team}: ${p.when}`,
          heading: "You're playing!",
          paragraphs: [
            `The captain of ${p.team} said yes. You're in for ${p.teams}, ${p.when}.`,
            "Wear the team's color if you can. If your plans change, drop out from the sub page so they can find someone else.",
          ],
          action: { label: "See the details", path: "/app/subs" },
          reason: `you offered to sub for ${p.team}`,
        },
        ctx,
      );
    case "declined":
      return renderEmail(
        {
          subject: `${p.team} is covered: ${p.when}`,
          heading: "Thanks for offering",
          paragraphs: [
            `The captain of ${p.team} has what they need for ${p.teams}, ${p.when}. Thanks for stepping up.`,
          ],
          action: { label: "See other requests", path: "/app/subs" },
          reason: `you offered to sub for ${p.team}`,
        },
        ctx,
      );
    case "cancelled":
      return renderEmail(
        {
          subject: `${p.team} no longer needs subs: ${p.when}`,
          heading: "Request taken down",
          paragraphs: [
            `${p.team} took down its sub request for ${p.teams}, ${p.when}, so you're not playing in it. Thanks for offering.`,
          ],
          action: { label: "See other requests", path: "/app/subs" },
          reason: `you offered to sub for ${p.team}`,
        },
        ctx,
      );
  }
});
