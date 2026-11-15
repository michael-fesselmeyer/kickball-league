"use server";

import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { db, txDb } from "@/db/client";
import {
  loadSchedulerInput,
  loadVersion,
  publishVersion,
  saveVersion,
} from "@/db/queries/schedule";
import { fieldsMissingLayout } from "@/db/queries/field-layouts";
import { seasonBySlug, versionsOf } from "@/db/queries/schedule-screen";
import { parseId, type ScheduleVersionId } from "@/domain/ids";
import { parseOverrideReason } from "@/domain/permits/coverage";
import { applyEdit } from "@/domain/scheduler/edits";
import { generate } from "@/domain/scheduler/generate";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { refreshSeasonPages } from "@/lib/public-cache";
import { sendQueuedSoon } from "@/services/outbox";
import { applyAll, stateOf } from "./board-model";
import { activeLeagueId } from "@/lib/league/active";

const pageFor = (slug: string) => `/app/admin/seasons/${slug}/schedule`;

/** A whole number from the form within [min, max], or null. */
function whole(form: FormData, name: string, min: number, max: number) {
  const value = Number(form.get(name));
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

/** Generates a new draft version from the season as it stands. */
export async function generateDraft(
  slug: string,
  form: FormData,
): Promise<void> {
  const page = pageFor(slug);
  const subject = await requirePermissionToChange("schedule.manage", {
    next: page,
  });
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  if (!season) notFound();

  const rounds = whole(form, "rounds", 1, 60);
  const reservePerDay = whole(form, "reserve", 0, 20);
  const seed = whole(form, "seed", 0, 2_147_483_647);
  if (rounds === null || reservePerDay === null || seed === null)
    redirect(`${page}?error=bad_input`);

  const loaded = await loadSchedulerInput(db, season.id, {
    rounds,
    reservePerDay,
    seed,
  });
  if (!loaded.ok) notFound();
  // A fresh draft follows the published schedule, so it can be published
  // over it; with nothing published, the newest version.
  const versions = await versionsOf(db, season.id);
  const latest = versions.find((v) => v.status === "published") ?? versions[0];
  await saveVersion(txDb, {
    seasonId: season.id,
    input: loaded.value,
    schedule: generate(loaded.value),
    origin: "generated",
    ...(latest ? { parentVersionId: latest.id } : {}),
    createdBy: subject.userId,
  });
  redirect(`${page}?generated=1`);
}

/** Publishes a draft version and sends any rain-out notices it queued. */
export async function publishDraft(
  slug: string,
  rawVersionId: string,
): Promise<void> {
  const versionId = parseId<ScheduleVersionId>(rawVersionId);
  // A malformed id is not found, not a database error.
  if (!versionId) notFound();
  const page = pageFor(slug);
  const subject = await requirePermissionToChange("schedule.manage", {
    next: page,
  });
  // Every field the schedule uses needs a layout, or an admin's word that
  // it needs none (#403), so set-up crews and refs know where the permit ends.
  if ((await fieldsMissingLayout(db, versionId)).length > 0)
    redirect(`${page}?error=missing_layout`);
  const result = await publishVersion(txDb, versionId, subject.userId);
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  const { moved, added, removed, teams, notified } = result.value;
  if (notified > 0) sendQueuedSoon();
  // The public schedule, standings and team pages show it right away.
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  if (season) refreshSeasonPages(season.id);
  redirect(
    `${page}?published=1&moved=${moved.length}&added=${added.length}&removed=${removed.length}&teams=${teams.length}&notified=${notified}`,
  );
}

/**
 * Publishes a draft whose only gaps are permit documents not uploaded yet,
 * with the admin's reason in the audit log (ADR 0066). A lost permit, no
 * permit, or hours that fall short still block it.
 */
export async function publishWithoutDocuments(
  slug: string,
  rawVersionId: string,
  form: FormData,
): Promise<void> {
  const versionId = parseId<ScheduleVersionId>(rawVersionId);
  if (!versionId) notFound();
  const page = pageFor(slug);
  const subject = await requirePermissionToChange("schedule.manage", {
    next: page,
  });
  const reason = parseOverrideReason(form.get("reason"));
  if (!reason.ok) redirect(`${page}?error=${reason.error}`);
  const result = await publishVersion(
    txDb,
    versionId,
    subject.userId,
    new Date(),
    reason.value,
  );
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  const { moved, added, removed, teams, notified } = result.value;
  if (notified > 0) sendQueuedSoon();
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  if (season) refreshSeasonPages(season.id);
  redirect(
    `${page}?published=1&moved=${moved.length}&added=${added.length}&removed=${removed.length}&teams=${teams.length}&notified=${notified}`,
  );
}

/**
 * Moves a game to an empty slot, or swaps it with the game in that slot, and
 * saves the result as a new draft. Violations are kept on the draft, which
 * blocks publishing until they are fixed.
 */
export async function editGame(
  slug: string,
  rawVersionId: string,
  form: FormData,
): Promise<void> {
  const versionId = parseId<ScheduleVersionId>(rawVersionId);
  // A malformed id is not found, not a database error.
  if (!versionId) notFound();
  const page = pageFor(slug);
  const subject = await requirePermissionToChange("schedule.manage", {
    next: page,
  });
  const version = await loadVersion(db, versionId);
  const gameKey = form.get("game");
  const slotId = form.get("slot");
  if (!version || typeof gameKey !== "string" || typeof slotId !== "string")
    redirect(`${page}?error=bad_input`);

  const occupant = version.schedule.games.find(
    (g) => g.slotId === slotId && g.key !== gameKey,
  );
  const pin = form.get("pin") === "on";
  const result = applyEdit(
    version.input,
    version.schedule,
    occupant
      ? { kind: "swap", gameKeys: [gameKey, occupant.key], pin }
      : { kind: "move", gameKey, slotId, pin },
  );
  if (!result.ok) redirect(`${page}?error=${result.error.code}`);

  await saveVersion(txDb, {
    seasonId: version.seasonId,
    input: { ...version.input, locked: result.value.locked },
    schedule: result.value.schedule,
    origin: "manual_edit",
    parentVersionId: version.id,
    createdBy: subject.userId,
  });
  redirect(`${page}?edited=1`);
}

const key = z.string().min(1).max(200);
const boardEdits = z
  .array(
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("move"), gameKey: key, slotId: key }),
      z.object({ kind: z.literal("swap"), gameKeys: z.tuple([key, key]) }),
    ]),
  )
  .min(1)
  .max(200);

/** The board's edits from the form, or null when they do not parse. */
function parseEdits(raw: FormDataEntryValue | null) {
  if (typeof raw !== "string") return null;
  try {
    const parsed = boardEdits.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Saves the moves and swaps made on the schedule board as one new draft.
 * The edits are applied again here, in order, with the same scheduler code
 * the board used for its preview.
 */
export async function saveBoard(
  slug: string,
  rawVersionId: string,
  form: FormData,
): Promise<void> {
  const versionId = parseId<ScheduleVersionId>(rawVersionId);
  // A malformed id is not found, not a database error.
  if (!versionId) notFound();
  const page = pageFor(slug);
  const subject = await requirePermissionToChange("schedule.manage", {
    next: page,
  });
  const version = await loadVersion(db, versionId);
  const edits = parseEdits(form.get("edits"));
  if (!version || !edits) redirect(`${page}?error=bad_input`);

  const result = applyAll(
    stateOf(version.input, version.schedule),
    edits,
    form.get("pin") === "on",
  );
  if (!result.ok) redirect(`${page}?error=${result.error.code}`);

  await saveVersion(txDb, {
    seasonId: version.seasonId,
    input: result.value.input,
    schedule: result.value.schedule,
    origin: "manual_edit",
    parentVersionId: version.id,
    createdBy: subject.userId,
  });
  redirect(`${page}?edited=${edits.length}`);
}
