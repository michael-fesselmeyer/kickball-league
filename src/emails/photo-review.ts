import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/**
 * Tells a member whether the league used a photo they uploaded (ADR 0035).
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

export const photoReviewEmail = defineTemplate(photoReviewPayload, (p, ctx) =>
  p.kind === "approved"
    ? renderEmail(
        {
          subject: "Your photo made the cut",
          heading: "Your photo is up",
          paragraphs: [
            `Thanks for sharing! The league approved your photo, and it now shows on ${p.where}. It may also turn up on the league's socials.`,
            "You can delete it from your photos at any time.",
          ],
          action: { label: "See it on the site", path: p.path },
          reason: "you uploaded a photo for the league",
        },
        ctx,
      )
    : renderEmail(
        {
          subject: "About the photo you uploaded",
          heading: "The league didn't use your photo",
          paragraphs: [
            "Thanks for sending it in. The league won't be posting this one, so it has been deleted from the site.",
            "Keep them coming: clear, well-lit photos of game days and events have the best chance.",
          ],
          action: { label: "Your photos", path: "/app/photos" },
          reason: "you uploaded a photo for the league",
        },
        ctx,
      ),
);
