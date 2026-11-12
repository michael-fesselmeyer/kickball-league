"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  loadSchedulerInput,
  loadVersion,
  publishVersion,
  saveVersion,
} from "@/db/queries/schedule";
import { seasonBySlug, versionsOf } from "@/db/queries/schedule-screen";
import type { ScheduleVersionId } from "@/domain/ids";
import { applyEdit } from "@/domain/scheduler/edits";
import { generate } from "@/domain/scheduler/generate";
import { requirePermission } from "@/lib/auth/permission";
import { sendQueuedSoon } from "@/services/outbox";

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
  const subject = await requirePermission("schedule.manage", { next: page });
  const season = await seasonBySlug(db, slug);
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
  const [latest] = await versionsOf(db, season.id);
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
  versionId: ScheduleVersionId,
): Promise<void> {
  const page = pageFor(slug);
  const subject = await requirePermission("schedule.manage", { next: page });
  const result = await publishVersion(txDb, versionId, subject.userId);
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  const { moved, added, removed, teams, notified } = result.value;
  if (notified > 0) sendQueuedSoon();
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
  versionId: ScheduleVersionId,
  form: FormData,
): Promise<void> {
  const page = pageFor(slug);
  const subject = await requirePermission("schedule.manage", { next: page });
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
