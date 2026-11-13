"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { sendWaitlistOffers } from "@/db/queries/waitlist";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { sendQueuedSoon } from "@/services/outbox";

/**
 * Sends the next offers now instead of waiting for the job: expires offers
 * that ran out and offers each free spot to the next team in line.
 */
export async function offerNowAction(slug: string): Promise<void> {
  const page = `/app/admin/seasons/${slug}/waitlist`;
  await requirePermissionToChange("season.manage", { next: page });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  const result = await txDb.transaction((tx) =>
    sendWaitlistOffers(tx, new Date(), season.id),
  );
  if (result.offered > 0) sendQueuedSoon();
  redirect(`${page}?offered=${result.offered}`);
}
