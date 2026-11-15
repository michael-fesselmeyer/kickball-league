import { z } from "zod";
import { fill, plural } from "@/i18n/catalog";
import { defineTemplate } from "./define";
import { emailWords, publicPath, renderEmail } from "./layout";

/**
 * Tells every player in the active seasons that the league's rules are
 * changing, at least a few days before the change takes effect (ADR 0062).
 * The rules page has the new text; the email names what changed and when.
 */
export const ruleChangePayload = z.object({
  /** The admin's one-line summary. */
  summary: z.string().min(1),
  /** The titles of the sections changed. */
  sections: z.array(z.string().min(1)).min(1),
  /** Such as "Saturday, March 20, 2027". */
  effectiveOn: z.string().min(1),
  /** The league's rules page: `/rules`, or `/l/<slug>/rules` (ADR 0048). */
  rulesPath: z.string().startsWith("/").default("/rules"),
  /** The first changed section still on the page, to link to. */
  anchor: z.string().nullable(),
});

export type RuleChangePayload = z.infer<typeof ruleChangePayload>;

export const ruleChangeEmail = defineTemplate(ruleChangePayload, (p, ctx) => {
  const { locale, w: all } = emailWords(ctx);
  const w = all.ruleChange;
  const vars = { on: p.effectiveOn, summary: p.summary };
  const path = p.anchor ? `${p.rulesPath}#${p.anchor}` : p.rulesPath;
  return renderEmail(
    {
      subject: fill(w.subject, vars),
      heading: w.heading,
      paragraphs: [
        p.summary,
        fill(w.effective, vars),
        plural(locale, w.sections, p.sections.length, {
          sections: p.sections.join(", "),
        }),
        w.read,
      ],
      action: { label: w.action, path: publicPath(ctx, path) },
      reason: w.reason,
    },
    ctx,
  );
});
