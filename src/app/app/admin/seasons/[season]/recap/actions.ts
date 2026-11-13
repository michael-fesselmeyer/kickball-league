"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { recapFacts } from "@/domain/ai/recap";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { aiConfig } from "@/lib/ai/config";
import { writeRecapDraft } from "@/lib/ai/recap";
import { formStrings } from "@/lib/form";
import { requireFeature } from "@/lib/platform/site";
import { recapData } from "./recap-data";

/**
 * Asks the AI provider for a recap of one game day. The draft is saved for
 * the admin to edit on the recap screen; nothing is sent from here.
 */
export async function writeAiRecapAction(
  slug: string,
  form: FormData,
): Promise<void> {
  await requireFeature("ai");
  const config = aiConfig();
  if (!config) notFound();
  const page = `/app/admin/seasons/${slug}/recap`;
  const subject = await requirePermissionToChange("announcement.send", {
    next: page,
    scope: "league",
  });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  const { day: requested } = formStrings(form, ["day"] as const);
  const { day, input } = await recapData(season, requested);
  if (day === null || input === null || day !== requested) notFound();

  const result = await writeRecapDraft(
    { db, txDb, call: config.call, model: config.model, now: new Date() },
    {
      leagueId: season.leagueId,
      seasonId: season.id,
      day,
      facts: recapFacts(input),
      actorId: subject.userId,
    },
  );
  redirect(
    `${page}?day=${day}&${result.ok ? "ai=written" : `ai_error=${result.error}`}`,
  );
}
