import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/**
 * Tells every player in the active seasons that the league's rules are
 * changing, at least a few days before the change takes effect (ADR 0056).
 * The rules page has the new text; the email names what changed and when.
 */
export const ruleChangePayload = z.object({
  /** The admin's one-line summary. */
  summary: z.string().min(1),
  /** The titles of the sections changed. */
  sections: z.array(z.string().min(1)).min(1),
  /** Such as "Saturday, March 20, 2027". */
  effectiveOn: z.string().min(1),
  /** The first changed section still on the page, to link to. */
  anchor: z.string().nullable(),
});

export type RuleChangePayload = z.infer<typeof ruleChangePayload>;

export const ruleChangeEmail = defineTemplate(ruleChangePayload, (p, ctx) =>
  renderEmail(
    {
      subject: `Rule change from ${p.effectiveOn}: ${p.summary}`,
      heading: "The league's rules are changing",
      paragraphs: [
        p.summary,
        `It takes effect on ${p.effectiveOn}.`,
        `${p.sections.length === 1 ? "Section" : "Sections"} changed: ${p.sections.join(", ")}.`,
        "Read the new wording on the rules page, and ask your captain or the league if anything is unclear.",
      ],
      action: {
        label: "Read the rules",
        path: p.anchor ? `/rules#${p.anchor}` : "/rules",
      },
      reason: "you play in a season with the league",
    },
    ctx,
  ),
);
