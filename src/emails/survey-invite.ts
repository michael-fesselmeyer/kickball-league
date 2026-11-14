import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/** The one invite each player gets when a season's survey opens. */
export const surveyInvitePayload = z.object({
  seasonName: z.string().min(1),
  seasonSlug: z.string().min(1),
});

export type SurveyInvitePayload = z.infer<typeof surveyInvitePayload>;

export const surveyInviteEmail = defineTemplate(surveyInvitePayload, (p, ctx) =>
  renderEmail(
    {
      subject: `How was ${p.seasonName}?`,
      heading: `How was ${p.seasonName}?`,
      paragraphs: [
        "Five quick questions about the season, about two minutes. Your answers are anonymous: the league sees totals and comments, never who wrote them.",
      ],
      action: {
        label: "Answer the survey",
        path: `/app/seasons/${p.seasonSlug}/survey`,
      },
      reason: `you played in ${p.seasonName}`,
    },
    ctx,
  ),
);
