"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { authorName, sendAnnouncement } from "@/db/queries/announcements";
import {
  myRegistration,
  seasonForRegistration,
} from "@/db/queries/registration";
import { currentLeague } from "@/db/queries/seasons";
import { can } from "@/domain/authz/permissions";
import { requirePermission } from "@/lib/auth/permission";
import { formStrings } from "@/lib/form";
import { sendQueuedSoon } from "@/services/outbox";

/** A captain's (or co-captain's) announcement to their own team. */
export async function sendTeamAnnouncementAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const page = `/app/seasons/${slug}/team/announcements`;
  const subject = await requirePermission("registration.join", { next: page });
  const league = await currentLeague(db);
  const season = league
    ? await seasonForRegistration(db, league.id, slug)
    : null;
  if (!season) notFound();
  const mine = await myRegistration(db, season.id, subject.userId);
  const team = mine?.team;
  if (
    !team ||
    !can(subject, "announcement.send", {
      scope: "team",
      teamSeasonId: team.teamSeasonId,
    })
  )
    notFound();
  const values = formStrings(form, ["subject", "body"] as const);
  const isAdmin =
    subject.globalRole === "admin" || subject.globalRole === "owner";
  const name = await authorName(db, subject.userId);
  const role = team.role === "co_captain" ? "co-captain" : "captain";
  const result = await txDb.transaction((tx) =>
    sendAnnouncement(tx, {
      authorId: subject.userId,
      role: isAdmin ? "admin" : "captain",
      seasonId: season.id,
      seasonName: season.name,
      seasonSlug: season.slug,
      team: { id: team.teamSeasonId, name: team.teamName },
      from: `${name}, ${role} of ${team.teamName}`,
      subject: values.subject,
      body: values.body,
      now: new Date(),
    }),
  );
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  sendQueuedSoon();
  redirect(`${page}?sent=${result.value.recipients}`);
}
