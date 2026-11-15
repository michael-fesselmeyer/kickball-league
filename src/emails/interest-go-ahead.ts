import { z } from "zod";
import { MAX_NOTE } from "@/domain/interest/interest";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/**
 * Tells everyone who showed interest in a new night, park or format that
 * the league is going ahead with it. It goes to an address with no account,
 * once per person and option, so it says why they are getting it.
 */
export const interestGoAheadPayload = z.object({
  leagueName: z.string().min(1),
  optionLabel: z.string().min(1),
  /** What the league added, such as when registration opens; may be empty. */
  note: z.string().max(MAX_NOTE),
});

export const interestGoAheadEmail = defineTemplate(
  interestGoAheadPayload,
  (p, ctx) =>
    renderEmail(
      {
        subject: `${p.optionLabel} is going ahead`,
        heading: "It's going ahead",
        paragraphs: [
          `${p.leagueName} is going ahead with ${p.optionLabel}. You told us you were interested, so you're the first to hear.`,
          ...(p.note ? [p.note] : []),
          "This is the only message about it. If it wasn't you who answered, ignore it.",
        ],
        action: { label: "See the league", path: "/" },
        reason: `you answered ${p.leagueName}'s interest form`,
        // The address has no account to hold settings, so point to the league.
        settings: { label: "Questions? Contact the league", path: "/contact" },
      },
      ctx,
    ),
);
