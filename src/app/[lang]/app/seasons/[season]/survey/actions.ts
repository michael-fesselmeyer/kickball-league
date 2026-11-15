"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { activeLeagueId } from "@/lib/league/active";
import { answerSurvey, surveyForSeason } from "@/db/queries/surveys";
import { parseAnswerForm } from "@/domain/survey/questions";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { formStrings } from "@/lib/form";

const FIELDS = [
  "rating",
  "wouldReturn",
  "bestPart",
  "oneChange",
  "comment",
] as const;

/**
 * A player's one answer to the season's survey. Whether they were on a
 * roster, whether the survey is open and whether they answered already
 * are all checked by answerSurvey; the database keeps it to one.
 */
export async function answerSurveyAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const page = `/app/seasons/${slug}/survey`;
  const subject = await requirePermissionToChange("survey.answer", {
    next: page,
  });
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  const survey = season ? await surveyForSeason(db, season.id) : null;
  if (!survey) notFound();
  const parsed = parseAnswerForm(formStrings(form, FIELDS));
  if (!parsed.ok) redirect(`${page}?error=${parsed.error}`);
  const answered = await txDb.transaction((tx) =>
    answerSurvey(tx, {
      surveyId: survey.id,
      userId: subject.userId,
      answer: parsed.value,
    }),
  );
  if (!answered.ok) redirect(`${page}?error=${answered.error}`);
  redirect(`${page}?notice=thanks`);
}
