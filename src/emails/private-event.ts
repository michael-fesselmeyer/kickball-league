import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

const about = {
  /** The organization the league or tournament is for. */
  organization: z.string().min(1),
  kind: z.enum(["tournament", "league"]),
};

/**
 * Private leagues and tournaments (ADR 0049), for the organizer: the
 * request arrived, it was accepted as a private season, or the league
 * can't take it.
 */
export const privateEventPayload = z.discriminatedUnion("step", [
  z.object({ ...about, step: z.literal("received") }),
  z.object({
    ...about,
    step: z.literal("accepted"),
    seasonName: z.string().min(1),
    seasonSlug: z.string().min(1),
  }),
  z.object({
    ...about,
    step: z.literal("declined"),
    reason: z.string().nullable(),
  }),
]);

export type PrivateEventPayload = z.infer<typeof privateEventPayload>;

const what = (kind: "tournament" | "league") =>
  kind === "tournament" ? "tournament" : "private league";

export const privateEventEmail = defineTemplate(
  privateEventPayload,
  (p, ctx) => {
    const reason = `you asked the league for a ${what(p.kind)} for ${p.organization}`;
    switch (p.step) {
      case "received":
        return renderEmail(
          {
            subject: `We got your ${what(p.kind)} request`,
            heading: "Thanks, we have your request",
            paragraphs: [
              `The league has your request for a ${what(p.kind)} for ${p.organization}. An admin will look at fields and dates and get back to you, usually within a week.`,
              "You can see where it stands at any time.",
            ],
            action: { label: "See your request", path: "/app/private-events" },
            reason,
          },
          ctx,
        );
      case "accepted":
        return renderEmail(
          {
            subject: `${p.seasonName} is on`,
            heading: `Your ${what(p.kind)} is set up`,
            paragraphs: [
              `The league set up ${p.seasonName} for ${p.organization}. It is private: only your teams can join, and nothing about it shows on the league's public pages.`,
              "Share the invite link with each team's captain. Your page shows the teams as they join, the schedule once it is out, and the results.",
            ],
            action: {
              label: "Open your organizer page",
              path: `/app/private-events/${p.seasonSlug}`,
            },
            reason,
          },
          ctx,
        );
      case "declined":
        return renderEmail(
          {
            subject: `About your ${what(p.kind)} request`,
            heading: "Your request",
            paragraphs: [
              `The league can't host a ${what(p.kind)} for ${p.organization} this time.`,
              ...(p.reason ? [`From the league: ${p.reason}`] : []),
              "You're welcome to ask again for other dates.",
            ],
            action: { label: "Ask again", path: "/app/private-events/new" },
            reason,
          },
          ctx,
        );
    }
  },
);
