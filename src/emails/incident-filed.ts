import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/**
 * Tells a league's owners and admins that a report was filed for a game
 * (ADR 0064). It says nothing about what kind of report it is, who it is
 * about or what happened: email is not a place for health details. The link
 * opens the report, which only owners and admins can read.
 */
export const incidentFiledPayload = z.object({
  incidentId: z.uuid(),
  /** "Aces vs Bees". */
  matchup: z.string().min(1).max(200),
});

export type IncidentFiledPayload = z.infer<typeof incidentFiledPayload>;

export const incidentFiledEmail = defineTemplate(
  incidentFiledPayload,
  (p, ctx) =>
    renderEmail(
      {
        subject: "A report was filed for a game",
        heading: "A report needs a look",
        paragraphs: [
          `A report was filed for ${p.matchup}.`,
          "Sign in to read it. Its details are not in this email.",
        ],
        action: {
          label: "Open the report",
          path: `/app/admin/incidents/${p.incidentId}`,
        },
        reason: "you are an owner or admin of the league",
      },
      ctx,
    ),
);
