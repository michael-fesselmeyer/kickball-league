import { z } from "zod";
import { fill } from "@/i18n/catalog";
import { defineTemplate } from "./define";
import { emailWords, renderEmail } from "./layout";

/** The one invite each player gets when a season's survey opens. */
export const surveyInvitePayload = z.object({
  seasonName: z.string().min(1),
  seasonSlug: z.string().min(1),
});

export type SurveyInvitePayload = z.infer<typeof surveyInvitePayload>;

export const surveyInviteEmail = defineTemplate(
  surveyInvitePayload,
  (p, ctx) => {
    const w = emailWords(ctx).w.survey;
    const vars = { season: p.seasonName };
    return renderEmail(
      {
        subject: fill(w.subject, vars),
        heading: fill(w.subject, vars),
        paragraphs: [w.lead],
        action: {
          label: w.action,
          path: `/app/seasons/${p.seasonSlug}/survey`,
        },
        reason: fill(w.reason, vars),
      },
      ctx,
    );
  },
);
