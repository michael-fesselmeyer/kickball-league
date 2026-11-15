"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  saveWinBackTemplate,
  sendWinBack,
  winBackSeason,
} from "@/db/queries/win-back";
import { parseId, type UserId } from "@/domain/ids";
import { parseTemplate } from "@/domain/win-back/win-back";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { activeLeagueId } from "@/lib/league/active";
import { refreshOwnerDashboard } from "@/lib/owner-dashboard-cache";
import { sendQueuedSoon } from "@/services/outbox";

const pageOf = (slug: string) => `/app/admin/seasons/${slug}/win-back`;

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

async function send(slug: string, userIds: readonly UserId[] | "all") {
  const page = pageOf(slug);
  const subject = await requirePermissionToChange("win_back.manage", {
    next: page,
  });
  const season = await winBackSeason(db, await activeLeagueId(), slug);
  if (!season) notFound();
  const sent = await txDb.transaction((tx) =>
    sendWinBack(tx, {
      season,
      userIds,
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  if (!sent.ok) redirect(`${page}?error=${sent.error}`);
  sendQueuedSoon();
  refreshOwnerDashboard();
  redirect(`${page}?sent=${sent.value}`);
}

/** One click: the win-back email to one past player. */
export async function sendOneAction(slug: string, form: FormData) {
  const userId = parseId<UserId>(form.get("userId"));
  if (!userId) notFound();
  await send(slug, [userId]);
}

/** The win-back email to everyone on the list who hasn't had it. */
export async function sendAllAction(slug: string) {
  await send(slug, "all");
}

/** Saves the league's wording for the win-back email. */
export async function saveTemplateAction(slug: string, form: FormData) {
  const page = pageOf(slug);
  const subject = await requirePermissionToChange("win_back.manage", {
    next: page,
  });
  const season = await winBackSeason(db, await activeLeagueId(), slug);
  if (!season) notFound();
  const parsed = parseTemplate({
    subject: text(form, "subject"),
    body: text(form, "body"),
  });
  if (!parsed.ok) redirect(`${page}?error=${parsed.error}#wording`);
  await saveWinBackTemplate(
    db,
    { leagueId: season.leagueId, ...parsed.value },
    subject.userId,
  );
  redirect(`${page}?saved=1#wording`);
}
