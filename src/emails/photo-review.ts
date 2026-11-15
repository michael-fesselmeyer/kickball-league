import { z } from "zod";
import { fill } from "@/i18n/catalog";
import { defineTemplate } from "./define";
import { emailWords, publicPath, renderEmail } from "./layout";

/**
 * Tells a member whether the league used a photo they uploaded (ADR 0039).
 * A rejection never carries the admin's note: that stays private.
 */
export const photoReviewPayload = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("approved"),
    /** Where it shows, as "the team page for Sun Kickers". */
    where: z.string().min(1),
    /** The public page it shows on. */
    path: z.string().startsWith("/"),
  }),
  z.object({ kind: z.literal("rejected") }),
]);

export type PhotoReviewPayload = z.infer<typeof photoReviewPayload>;

export const photoReviewEmail = defineTemplate(photoReviewPayload, (p, ctx) => {
  const w = emailWords(ctx).w.photo;
  return p.kind === "approved"
    ? renderEmail(
        {
          subject: w.approvedSubject,
          heading: w.approvedHeading,
          paragraphs: [
            fill(w.approvedLead, { where: p.where }),
            w.deleteAnytime,
          ],
          action: { label: w.seeIt, path: publicPath(ctx, p.path) },
          reason: w.reason,
        },
        ctx,
      )
    : renderEmail(
        {
          subject: w.rejectedSubject,
          heading: w.rejectedHeading,
          paragraphs: [w.rejectedLead, w.keepThem],
          action: { label: w.yourPhotos, path: "/app/photos" },
          reason: w.reason,
        },
        ctx,
      );
});
