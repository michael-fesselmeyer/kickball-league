import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/** An admin sent a rain-out to the owners to confirm (ADR 0057). */
export const rainoutRequestPayload = z.object({
  seasonName: z.string().min(1),
  seasonSlug: z.string().min(1),
  date: z.iso.date(),
  /** "Sun, Sep 13". */
  day: z.string().min(1),
  /** The admin's name as the league shows it. */
  from: z.string().min(1).max(120),
  /** The decision card's sentence, when the weather could be read. */
  summary: z.string().min(1).max(600).nullable(),
});

export type RainoutRequestPayload = z.infer<typeof rainoutRequestPayload>;

export const rainoutRequestEmail = defineTemplate(
  rainoutRequestPayload,
  (p, ctx) =>
    renderEmail(
      {
        subject: `Confirm the rain-out for ${p.day}? ${p.seasonName}`,
        heading: `${p.from} wants to rain out ${p.day}`,
        paragraphs: [
          `${p.from} looked at the weather and the makeups for ${p.seasonName} on ${p.day} and sent the rain-out to you to confirm.`,
          ...(p.summary ? [p.summary] : []),
          "Nothing is cancelled until you confirm it on the rain-out screen.",
        ],
        action: {
          label: "Review and confirm",
          path: `/app/admin/seasons/${p.seasonSlug}/rainout?date=${p.date}`,
        },
        reason: "you are a league owner and confirm rain-outs",
      },
      ctx,
    ),
);
