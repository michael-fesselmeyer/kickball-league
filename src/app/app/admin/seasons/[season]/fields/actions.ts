"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  addBlackout,
  addField,
  addPermitWindows,
  addVenue,
  type PermitStatus,
  removeBlackout,
  removePermitWindow,
  setPermitStatus,
  syncSlots,
} from "@/db/queries/fields";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import type {
  BlackoutId,
  FieldId,
  PermitWindowId,
  VenueId,
} from "@/domain/ids";
import { weeklyDates } from "@/domain/time/zoned";
import { requirePermission } from "@/lib/auth/permission";

const pageFor = (slug: string) => `/app/admin/seasons/${slug}/fields`;
const STATUSES: readonly PermitStatus[] = ["requested", "confirmed", "lost"];

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

/** Checks the admin may manage the season, and finds it. */
async function context(slug: string) {
  const page = pageFor(slug);
  const subject = await requirePermission("season.manage", { next: page });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  return { page, actor: subject.userId, season };
}

/** Back to the screen with an error code, or a notice, in the query string. */
function back(
  page: string,
  section: string,
  query: Record<string, string | number>,
): never {
  const params = new URLSearchParams(
    Object.entries(query).map(([k, v]) => [k, String(v)]),
  );
  redirect(`${page}?${params.toString()}#${section}`);
}

export async function createVenue(slug: string, form: FormData) {
  const { page, actor, season } = await context(slug);
  const result = await txDb.transaction((tx) =>
    addVenue(
      tx,
      {
        leagueId: season.leagueId,
        name: text(form, "name"),
        address: text(form, "address"),
        neighborhood: text(form, "neighborhood"),
      },
      actor,
    ),
  );
  if (!result.ok) back(page, "venues", { error: `venue_${result.error}` });
  back(page, "venues", { notice: "venue_added" });
}

export async function createField(slug: string, form: FormData) {
  const { page, actor, season } = await context(slug);
  const result = await txDb.transaction((tx) =>
    addField(
      tx,
      {
        leagueId: season.leagueId,
        venueId: text(form, "venueId") as VenueId,
        name: text(form, "name"),
      },
      actor,
    ),
  );
  if (!result.ok) back(page, "venues", { error: `field_${result.error}` });
  back(page, "venues", { notice: "field_added" });
}

export async function createPermits(slug: string, form: FormData) {
  const { page, actor, season } = await context(slug);
  const first = text(form, "firstDate");
  const weeks = Number(form.get("weeks"));
  const status = text(form, "status") as PermitStatus;
  const startTime = text(form, "startTime");
  const endTime = text(form, "endTime");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(first) ||
    !Number.isInteger(weeks) ||
    weeks < 1 ||
    weeks > 26 ||
    !STATUSES.includes(status) ||
    !/^\d{2}:\d{2}$/.test(startTime) ||
    !/^\d{2}:\d{2}$/.test(endTime)
  )
    back(page, "permits", { error: "permit_bad_input" });
  const result = await txDb.transaction((tx) =>
    addPermitWindows(
      tx,
      {
        leagueId: season.leagueId,
        seasonId: season.id,
        fieldId: text(form, "fieldId") as FieldId,
        dates: weeklyDates(first, weeks),
        startTime,
        endTime,
        timeZone: season.timeZone,
        permitNumber: text(form, "permitNumber"),
        status,
      },
      actor,
    ),
  );
  if (!result.ok) back(page, "permits", { error: `permit_${result.error}` });
  back(page, "permits", { notice: "permits_added", count: result.value });
}

export async function changePermitStatus(
  slug: string,
  permitId: PermitWindowId,
  form: FormData,
) {
  const { page, actor, season } = await context(slug);
  const status = text(form, "status") as PermitStatus;
  if (!STATUSES.includes(status))
    back(page, "permits", { error: "permit_bad_input" });
  const result = await txDb.transaction((tx) =>
    setPermitStatus(tx, { seasonId: season.id, permitId, status }, actor),
  );
  if (!result.ok) back(page, "permits", { error: `permit_${result.error}` });
  back(page, "permits", { notice: "permit_updated" });
}

export async function deletePermit(slug: string, permitId: PermitWindowId) {
  const { page, actor, season } = await context(slug);
  const result = await txDb.transaction((tx) =>
    removePermitWindow(tx, { seasonId: season.id, permitId }, actor),
  );
  if (!result.ok) back(page, "permits", { error: `permit_${result.error}` });
  back(page, "permits", { notice: "permit_deleted" });
}

export async function createBlackout(slug: string, form: FormData) {
  const { page, actor, season } = await context(slug);
  const fieldId = text(form, "fieldId");
  const result = await txDb.transaction((tx) =>
    addBlackout(
      tx,
      {
        leagueId: season.leagueId,
        seasonId: season.id,
        onDate: text(form, "onDate"),
        fieldId: fieldId ? (fieldId as FieldId) : null,
        reason: text(form, "reason"),
      },
      actor,
    ),
  );
  if (!result.ok)
    back(page, "blackouts", { error: `blackout_${result.error}` });
  back(page, "blackouts", { notice: "blackout_added" });
}

export async function deleteBlackout(slug: string, blackoutId: BlackoutId) {
  const { page, actor, season } = await context(slug);
  const result = await txDb.transaction((tx) =>
    removeBlackout(tx, { seasonId: season.id, blackoutId }, actor),
  );
  if (!result.ok)
    back(page, "blackouts", { error: `blackout_${result.error}` });
  back(page, "blackouts", { notice: "blackout_deleted" });
}

export async function cutSlots(slug: string, form: FormData) {
  const { page, actor, season } = await context(slug);
  const result = await txDb.transaction((tx) =>
    syncSlots(
      tx,
      {
        seasonId: season.id,
        slotMinutes: Number(form.get("slotMinutes")),
        timeZone: season.timeZone,
      },
      actor,
    ),
  );
  if (!result.ok) back(page, "slots", { error: `slots_${result.error}` });
  back(page, "slots", { notice: "slots_synced", ...result.value });
}
