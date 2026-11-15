import { z } from "zod";
import { fill } from "@/i18n/catalog";
import { defineTemplate } from "./define";
import { emailWords, renderEmail } from "./layout";

/**
 * Asks a registered player who has no shirt size the season offers to pick
 * one, once, before the league orders shirts.
 */
export const shirtSizePayload = z.object({
  seasonName: z.string().min(1),
  /** The season's sizes, written out, such as "XS, S, M, L, XL and XXL". */
  sizes: z.string().min(1),
});

export type ShirtSizePayload = z.infer<typeof shirtSizePayload>;

export const shirtSizeEmail = defineTemplate(shirtSizePayload, (p, ctx) => {
  const w = emailWords(ctx).w.shirt;
  const vars = { season: p.seasonName, sizes: p.sizes };
  return renderEmail(
    {
      subject: fill(w.subject, vars),
      heading: w.heading,
      paragraphs: [fill(w.lead, vars), fill(w.pick, vars)],
      action: { label: w.action, path: "/app/profile" },
      reason: fill(w.reason, vars),
    },
    ctx,
  );
});
