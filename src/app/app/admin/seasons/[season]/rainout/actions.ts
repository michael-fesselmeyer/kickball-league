"use server";

import { inArray } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { recordAudit } from "@/db/queries/audit";
import { loadVersion, saveVersion } from "@/db/queries/schedule";
import { seasonBySlug, versionsOf } from "@/db/queries/schedule-screen";
import { slot } from "@/db/schema/game";
import type { SlotId } from "@/domain/ids";
import { reschedule } from "@/domain/scheduler/reschedule";
import { requirePermission } from "@/lib/auth/permission";

/**
 * Calls a rain-out for a whole date: cancels its slots and saves a draft
 * version with the postponed games placed as makeups, in one transaction.
 * The admin reviews and publishes it on the schedule screen.
 */
export async function declareRainout(
  slug: string,
  date: string,
): Promise<void> {
  const page = `/app/admin/seasons/${slug}/rainout`;
  const subject = await requirePermission("rainout.declare", { next: page });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  const published = (await versionsOf(db, season.id)).find(
    (v) => v.status === "published",
  );
  const version = published ? await loadVersion(db, published.id) : null;
  if (!version) redirect(`${page}?error=no_published`);

  const cancelled = version.input.slots
    .filter((s) => s.date === date)
    .map((s) => s.id);
  if (cancelled.length === 0) redirect(`${page}?error=no_games`);
  const result = reschedule(version.input, version.schedule, cancelled);

  const draftId = await txDb.transaction(async (tx) => {
    await tx
      .update(slot)
      .set({ status: "cancelled" })
      .where(inArray(slot.id, cancelled as SlotId[]));
    const id = await saveVersion(tx, {
      seasonId: version.seasonId,
      // Cancelled slots are gone: they are neither reserve nor places to move to.
      input: {
        ...version.input,
        slots: version.input.slots.filter((s) => !cancelled.includes(s.id)),
        locked: result.locked,
      },
      schedule: result.schedule,
      origin: "rainout",
      parentVersionId: version.id,
      createdBy: subject.userId,
    });
    await recordAudit(tx, {
      actorId: subject.userId,
      action: "rainout.declare",
      entityType: "season",
      entityId: version.seasonId,
      after: {
        date,
        slotsCancelled: cancelled.length,
        postponed: result.moved.length,
        unplaced: result.moved.filter((m) => m.to === null).length,
        draftVersionId: id,
      },
    });
    return id;
  });
  redirect(`/app/admin/seasons/${slug}/schedule?rainout=${draftId}`);
}
