"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  sendAnnouncement,
  teamsToAnnounceTo,
} from "@/db/queries/announcements";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { formStrings } from "@/lib/form";
import { sendQueuedSoon } from "@/services/outbox";
import { requireFeature } from "@/lib/platform/site";

/** An admin's announcement to the whole league or to one team. */
export async function sendLeagueAnnouncementAction(
  slug: string,
  form: FormData,
): Promise<void> {
  await requireFeature("announcements");
  const page = `/app/admin/seasons/${slug}/announcements`;
  const subject = await requirePermissionToChange("announcement.send", {
    next: page,
    scope: "league",
  });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  const values = formStrings(form, ["audience", "subject", "body"] as const);
  const teams = await teamsToAnnounceTo(db, season.id);
  const team =
    values.audience === "league"
      ? null
      : (teams.find((t) => t.id === values.audience) ??
        redirect(`${page}?error=unknown_team`));
  const result = await txDb.transaction((tx) =>
    sendAnnouncement(tx, {
      authorId: subject.userId,
      role: "admin",
      seasonId: season.id,
      seasonName: season.name,
      seasonSlug: season.slug,
      team,
      from: "League admins",
      subject: values.subject,
      body: values.body,
      now: new Date(),
    }),
  );
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  sendQueuedSoon();
  redirect(`${page}?sent=${result.value.recipients}`);
}
