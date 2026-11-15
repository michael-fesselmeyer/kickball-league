"use server";

import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { publishSummary, unpublishSummary } from "@/db/queries/owner-dashboard";
import { requirePermissionToChange } from "@/lib/auth/permission";
import {
  refreshMoneySummary,
  refreshOwnerDashboard,
} from "@/lib/owner-dashboard-cache";
import { foldedFrom, liveSummary, ownerSeason } from "./load";

const dashboardPage = (slug: string) => `/app/owner/${slug}`;
const summaryPage = (slug: string) => `/app/owner/${slug}/summary`;

/** Reads fresh numbers now instead of waiting up to five minutes. */
export async function refreshDashboardAction(slug: string) {
  await requirePermissionToChange("dashboard.view", {
    next: dashboardPage(slug),
  });
  refreshOwnerDashboard();
  redirect(`${dashboardPage(slug)}?notice=refreshed`);
}

/**
 * Publishes the season's money summary with the chosen categories folded
 * into "Other". The numbers are worked out again here from the live books,
 * so what goes public is what the preview showed, never a posted value.
 */
export async function publishSummaryAction(slug: string, form: FormData) {
  const subject = await requirePermissionToChange("money_summary.publish", {
    next: summaryPage(slug),
  });
  const { league, season } = await ownerSeason(slug);
  const folded = foldedFrom(form.getAll("fold"));
  const live = await liveSummary(league.id, season, folded);
  const fold = folded.map((c) => ["fold", c]);
  if (live.blocker)
    redirect(
      `${summaryPage(slug)}?${new URLSearchParams([...fold, ["error", live.blocker]])}`,
    );
  await publishSummary(
    db,
    { seasonId: season.id, folded, summary: live.summary },
    subject.userId,
  );
  refreshMoneySummary(season.id);
  redirect(
    `${summaryPage(slug)}?${new URLSearchParams([...fold, ["notice", "published"]])}`,
  );
}

/** Takes the season's money summary off the public site. */
export async function unpublishSummaryAction(slug: string) {
  const subject = await requirePermissionToChange("money_summary.publish", {
    next: summaryPage(slug),
  });
  const { season } = await ownerSeason(slug);
  const result = await unpublishSummary(db, season.id, subject.userId);
  refreshMoneySummary(season.id);
  redirect(
    `${summaryPage(slug)}?${result.ok ? "notice=unpublished" : "error=not_published"}`,
  );
}
