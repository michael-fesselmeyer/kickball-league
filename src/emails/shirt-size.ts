import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

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

export const shirtSizeEmail = defineTemplate(shirtSizePayload, (p, ctx) =>
  renderEmail(
    {
      subject: `Your shirt size for ${p.seasonName}`,
      heading: "What size shirt do you wear?",
      paragraphs: [
        `The league is ordering shirts for ${p.seasonName}, and we don't have your size yet.`,
        `Pick yours on your profile: ${p.sizes}. It takes a few seconds.`,
      ],
      action: { label: "Pick my size", path: "/app/profile" },
      reason: `you're registered for ${p.seasonName}`,
    },
    ctx,
  ),
);
