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
import {
  tellOwnersOfNewGaps,
  uncoveredKeys,
} from "@/db/queries/permit-coverage";
import type { Db } from "@/db/queries/schedule";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import type {
  BlackoutId,
  FieldId,
  LeagueId,
  PermitWindowId,
  VenueId,
} from "@/domain/ids";
import { isOneOf } from "@/domain/guards";
import { parseId } from "@/domain/ids";
import { weeklyDates } from "@/domain/time/zoned";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { activeLeagueId } from "@/lib/league/active";
import { refreshParkPages } from "@/lib/public-cache";
import { requireInLeague } from "@/lib/league/guard";
import { sendQueuedSoon } from "@/services/outbox";

const pageFor = (slug: string) => `/app/admin/seasons/${slug}/fields`;
const STATUSES = [
  "requested",
  "confirmed",
  "lost",
] as const satisfies readonly PermitStatus[];

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

/**
 * Runs a permit change, then emails the owners once if games or events
 * that were covered before no longer are (issue #407). In the change's
 * transaction, so the email goes only with a change that was saved.
 */
async function withGapEmail<T extends { ok: boolean }>(
  tx: Db,
  leagueId: LeagueId,
  change: () => Promise<T>,
): Promise<T> {
  const now = new Date();
  const before = await uncoveredKeys(tx, leagueId, now);
  const result = await change();
  if (result.ok && (await tellOwnersOfNewGaps(tx, { leagueId, before, now })))
    sendQueuedSoon();
  return result;
}

/** Checks the admin may manage the season, and finds it. */
async function context(slug: string) {
  const page = pageFor(slug);
  const subject = await requirePermissionToChange("season.manage", {
    next: page,
  });
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
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
  refreshParkPages();
  back(page, "venues", { notice: "venue_added" });
}

export async function createField(slug: string, form: FormData) {
  const { page, actor, season } = await context(slug);
  const venueId = parseId<VenueId>(form.get("venueId"));
  if (!venueId) back(page, "venues", { error: "field_unknown_venue" });
  await requireInLeague(season, { venue: venueId });
  const result = await txDb.transaction((tx) =>
    addField(
      tx,
      {
        leagueId: season.leagueId,
        venueId,
        name: text(form, "name"),
      },
      actor,
    ),
  );
  if (!result.ok) back(page, "venues", { error: `field_${result.error}` });
  refreshParkPages();
  back(page, "venues", { notice: "field_added" });
}

export async function createPermits(slug: string, form: FormData) {
  const { page, actor, season } = await context(slug);
  const first = text(form, "firstDate");
  const weeks = Number(form.get("weeks"));
  const status = text(form, "status");
  const fieldId = parseId<FieldId>(form.get("fieldId"));
  await requireInLeague(season, { field: fieldId });
  const startTime = text(form, "startTime");
  const endTime = text(form, "endTime");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(first) ||
    !Number.isInteger(weeks) ||
    weeks < 1 ||
    weeks > 26 ||
    !isOneOf(STATUSES, status) ||
    !fieldId ||
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
        fieldId,
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
  refreshParkPages();
  back(page, "permits", { notice: "permits_added", count: result.value });
}

export async function changePermitStatus(
  slug: string,
  rawPermitId: string,
  form: FormData,
) {
  const permitId = parseId<PermitWindowId>(rawPermitId);
  // A malformed id is not found, not a database error.
  if (!permitId) notFound();
  const { page, actor, season } = await context(slug);
  const status = text(form, "status");
  if (!isOneOf(STATUSES, status))
    back(page, "permits", { error: "permit_bad_input" });
  const result = await txDb.transaction((tx) =>
    withGapEmail(tx, season.leagueId, () =>
      setPermitStatus(tx, { seasonId: season.id, permitId, status }, actor),
    ),
  );
  if (!result.ok) back(page, "permits", { error: `permit_${result.error}` });
  refreshParkPages();
  back(page, "permits", { notice: "permit_updated" });
}

export async function deletePermit(slug: string, rawPermitId: string) {
  const permitId = parseId<PermitWindowId>(rawPermitId);
  // A malformed id is not found, not a database error.
  if (!permitId) notFound();
  const { page, actor, season } = await context(slug);
  const result = await txDb.transaction((tx) =>
    withGapEmail(tx, season.leagueId, () =>
      removePermitWindow(tx, { seasonId: season.id, permitId }, actor),
    ),
  );
  if (!result.ok) back(page, "permits", { error: `permit_${result.error}` });
  refreshParkPages();
  back(page, "permits", { notice: "permit_deleted" });
}

export async function createBlackout(slug: string, form: FormData) {
  const { page, actor, season } = await context(slug);
  // Empty means every field; anything else must be one of the league's.
  const rawField = text(form, "fieldId");
  const fieldId = rawField ? parseId<FieldId>(rawField) : null;
  if (rawField && !fieldId)
    back(page, "blackouts", { error: "blackout_unknown_field" });
  const result = await txDb.transaction((tx) =>
    addBlackout(
      tx,
      {
        leagueId: season.leagueId,
        seasonId: season.id,
        onDate: text(form, "onDate"),
        fieldId,
        reason: text(form, "reason"),
      },
      actor,
    ),
  );
  if (!result.ok)
    back(page, "blackouts", { error: `blackout_${result.error}` });
  back(page, "blackouts", { notice: "blackout_added" });
}

export async function deleteBlackout(slug: string, rawBlackoutId: string) {
  const blackoutId = parseId<BlackoutId>(rawBlackoutId);
  // A malformed id is not found, not a database error.
  if (!blackoutId) notFound();
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
