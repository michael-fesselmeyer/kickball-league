import { z } from "zod";
import { renderEmail } from "./layout";
import { defineTemplate } from "./define";

/** What one copy of an announcement carries in the outbox. */
export const announcementPayload = z.object({
  subject: z.string().min(1).max(120),
  body: z.string().min(1).max(5000),
  /** Who it is from, as the recipient should read it: "League admins". */
  from: z.string().min(1),
  seasonName: z.string().min(1),
  seasonSlug: z.string().min(1),
  /** The team it went to; absent for the whole league. */
  teamName: z.string().min(1).optional(),
});

export type AnnouncementPayload = z.infer<typeof announcementPayload>;

export const announcementEmail = defineTemplate(announcementPayload, (p, ctx) =>
  renderEmail(
    {
      subject: p.subject,
      heading: p.subject,
      paragraphs: [
        ...p.body
          .split(/\n{2,}/)
          .map((part) => part.trim())
          .filter(Boolean),
        `— ${p.from}`,
      ],
      action: {
        label: "Open the league app",
        path: `/app/seasons/${p.seasonSlug}`,
      },
      reason: p.teamName
        ? `you play on ${p.teamName} in ${p.seasonName}`
        : `you are registered for ${p.seasonName}`,
    },
    ctx,
  ),
);
