import { z } from "zod";
import { fill } from "@/i18n/catalog";
import { defineTemplate } from "./define";
import { emailWords, renderEmail } from "./layout";

/** The one message each player gets when their season's card is ready. */
export const seasonCardPayload = z.object({
  seasonName: z.string().min(1),
  seasonSlug: z.string().min(1),
});

export type SeasonCardPayload = z.infer<typeof seasonCardPayload>;

export const seasonCardEmail = defineTemplate(seasonCardPayload, (p, ctx) => {
  const w = emailWords(ctx).w.seasonCard;
  const vars = { season: p.seasonName };
  return renderEmail(
    {
      subject: fill(w.subject, vars),
      heading: w.heading,
      paragraphs: [fill(w.lead, vars), w.private],
      action: { label: w.action, path: `/app/seasons/${p.seasonSlug}/card` },
      reason: fill(w.reason, vars),
    },
    ctx,
  );
});
