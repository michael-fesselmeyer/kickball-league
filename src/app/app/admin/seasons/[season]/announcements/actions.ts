"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  cancelScheduledAnnouncement,
  editScheduledAnnouncement,
  sendAnnouncement,
  teamsToAnnounceTo,
} from "@/db/queries/announcements";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { type AnnouncementId, parseId } from "@/domain/ids";
import { parseSendAt } from "@/domain/messaging/send-time";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { formStrings } from "@/lib/form";
import { sendQueuedSoon } from "@/services/outbox";
import { requireFeature } from "@/lib/platform/site";
import { activeLeagueId } from "@/lib/league/active";

const pageFor = (slug: string) => `/app/admin/seasons/${slug}/announcements`;

/** The signed-in admin and the season, for any change on this page. */
async function context(slug: string) {
  await requireFeature("announcements");
  const subject = await requirePermissionToChange("announcement.send", {
    next: pageFor(slug),
    scope: "league",
  });
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  if (!season) notFound();
  return { userId: subject.userId, season };
}

/**
 * An admin's announcement to the whole league or to one team, sent now or
 * scheduled for a sweep (ADR 0052).
 */
export async function sendLeagueAnnouncementAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const page = pageFor(slug);
  const { userId, season } = await context(slug);
  const values = formStrings(form, [
    "audience",
    "subject",
    "body",
    "when",
    "day",
  ] as const);
  const now = new Date();
  const sendAt = parseSendAt(
    { when: values.when || "now", day: values.day },
    now,
  );
  if (!sendAt.ok) redirect(`${page}?error=${sendAt.error}`);
  const teams = await teamsToAnnounceTo(db, season.id);
  const team =
    values.audience === "league"
      ? null
      : (teams.find((t) => t.id === values.audience) ??
        redirect(`${page}?error=unknown_team`));
  const result = await txDb.transaction((tx) =>
    sendAnnouncement(tx, {
      authorId: userId,
      role: "admin",
      seasonId: season.id,
      seasonName: season.name,
      seasonSlug: season.slug,
      team,
      from: "League admins",
      subject: values.subject,
      body: values.body,
      now,
      sendAt: sendAt.value,
    }),
  );
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  if (sendAt.value) redirect(`${page}?notice=scheduled#scheduled`);
  sendQueuedSoon();
  redirect(`${page}?sent=${result.value.recipients}`);
}

/** Changes a scheduled announcement's text or day before it sends. */
export async function editScheduledAction(
  slug: string,
  id: string,
  form: FormData,
): Promise<void> {
  const page = pageFor(slug);
  const { userId, season } = await context(slug);
  const values = formStrings(form, ["subject", "body", "when", "day"] as const);
  const sendAt = parseSendAt(
    { when: values.when || "day", day: values.day },
    new Date(),
  );
  if (!sendAt.ok) redirect(`${page}?error=${sendAt.error}#scheduled`);
  const at = sendAt.value;
  const announcementId = parseId<AnnouncementId>(id);
  if (!at) redirect(`${page}?error=bad_send_time#scheduled`);
  if (!announcementId) redirect(`${page}?error=already_sent#scheduled`);
  const result = await txDb.transaction((tx) =>
    editScheduledAnnouncement(tx, {
      id: announcementId,
      seasonId: season.id,
      actorId: userId,
      subject: values.subject,
      body: values.body,
      sendAt: at,
    }),
  );
  if (!result.ok) redirect(`${page}?error=${result.error}#scheduled`);
  redirect(`${page}?notice=edited#scheduled`);
}

/** Cancels a scheduled announcement before it sends. */
export async function cancelScheduledAction(
  slug: string,
  id: string,
): Promise<void> {
  const page = pageFor(slug);
  const { userId, season } = await context(slug);
  const announcementId = parseId<AnnouncementId>(id);
  if (!announcementId) redirect(`${page}?error=already_sent#scheduled`);
  const result = await txDb.transaction((tx) =>
    cancelScheduledAnnouncement(tx, {
      id: announcementId,
      seasonId: season.id,
      actorId: userId,
      now: new Date(),
    }),
  );
  if (!result.ok) redirect(`${page}?error=${result.error}#scheduled`);
  redirect(`${page}?notice=cancelled#scheduled`);
}
