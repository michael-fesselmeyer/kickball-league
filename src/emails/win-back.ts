import { z } from "zod";
import { SUBJECT_MAX } from "@/domain/win-back/win-back";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/**
 * The win-back invitation (issue #370): the league's own wording, already
 * filled in for the player when it was queued, and a button to sign up.
 */
export const winBackPayload = z.object({
  subject: z.string().min(1).max(SUBJECT_MAX),
  paragraphs: z.array(z.string().min(1)).min(1),
  actionLabel: z.string().min(1),
  actionPath: z.string().startsWith("/"),
  seasonName: z.string().min(1),
});

export type WinBackPayload = z.infer<typeof winBackPayload>;

export const winBackEmail = defineTemplate(winBackPayload, (p, ctx) =>
  renderEmail(
    {
      subject: p.subject,
      heading: p.subject,
      paragraphs: p.paragraphs,
      action: { label: p.actionLabel, path: p.actionPath },
      reason: `you played in the league before and ${p.seasonName} registration is open`,
    },
    ctx,
  ),
);
