"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { activeLeagueId } from "@/lib/league/active";
import { closeSurvey, openSurvey, surveyForSeason } from "@/db/queries/surveys";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { sendQueuedSoon } from "@/services/outbox";

const pageOf = (slug: string) => `/app/admin/seasons/${slug}/survey`;

/** Opens the survey for a completed season and invites its players. */
export async function openSurveyAction(slug: string): Promise<void> {
  const page = pageOf(slug);
  const subject = await requirePermissionToChange("survey.manage", {
    next: page,
  });
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  if (!season) notFound();
  const opened = await txDb.transaction((tx) =>
    openSurvey(tx, {
      seasonId: season.id,
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  if (!opened.ok) redirect(`${page}?error=${opened.error}`);
  sendQueuedSoon();
  redirect(`${page}?saved=opened&invited=${opened.value.invited}`);
}

/** Closes the survey: no more answers. */
export async function closeSurveyAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const page = pageOf(slug);
  const subject = await requirePermissionToChange("survey.manage", {
    next: page,
  });
  if (form.get("confirm") !== "yes") redirect(`${page}?error=confirm`);
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  const survey = season ? await surveyForSeason(db, season.id) : null;
  if (!survey) notFound();
  const closed = await txDb.transaction((tx) =>
    closeSurvey(tx, {
      id: survey.id,
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  if (!closed.ok) redirect(`${page}?error=closed`);
  redirect(`${page}?saved=closed`);
}
