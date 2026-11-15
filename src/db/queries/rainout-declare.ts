import { desc, eq } from "drizzle-orm";
import type { ScheduleVersionId, SeasonId, SlotId, UserId } from "@/domain/ids";
import { type Result, err, ok } from "@/domain/result";
import { reschedule } from "@/domain/scheduler/reschedule";
import { scheduleVersion } from "../schema/schedule";
import { recordAudit } from "./audit";
import { settleDayOnRainout } from "./game-day-status";
import { cancelOpenSlots } from "./rainout-decision";
import {
  type Db,
  type StoredVersion,
  loadVersion,
  lockSchedulePublish,
  saveVersion,
} from "./schedule";

export type DeclareRainoutError = "no_published" | "no_games" | "already";

/**
 * Rains out a whole date: cancels its open slots and saves a draft with the
 * postponed games placed as makeups, in the caller's transaction.
 *
 * Declares and publishes of a season take turns (the publish lock), and a
 * day is built on a rain-out still waiting to be published, if there is
 * one. So two rainy days in one weekend give one draft that carries both:
 * the second day's draft never undoes the first's makeups, and is never
 * refused as stale once the first is published.
 */
export async function declareRainout(
  db: Db,
  input: {
    seasonId: SeasonId;
    date: string;
    actorId: UserId;
    now?: Date;
  },
): Promise<Result<ScheduleVersionId, DeclareRainoutError>> {
  await lockSchedulePublish(db, input.seasonId);
  const versions = await db
    .select({
      id: scheduleVersion.id,
      status: scheduleVersion.status,
      origin: scheduleVersion.origin,
      parentVersionId: scheduleVersion.parentVersionId,
    })
    .from(scheduleVersion)
    .where(eq(scheduleVersion.seasonId, input.seasonId))
    .orderBy(desc(scheduleVersion.versionNo));
  const published = versions.find((v) => v.status === "published");
  const publishedVersion = published
    ? await loadVersion(db, published.id)
    : null;
  if (!published || !publishedVersion) return err("no_published");

  const cancelled = publishedVersion.input.slots
    .filter((s) => s.date === input.date)
    .map((s) => s.id as SlotId);
  if (cancelled.length === 0) return err("no_games");
  // Someone else confirmed this day first: nothing more to cancel.
  if ((await cancelOpenSlots(db, cancelled)).length === 0)
    return err("already");

  const base =
    (await pendingRainout(db, versions, published.id)) ?? publishedVersion;
  const result = reschedule(base.input, base.schedule, cancelled);
  const id = await saveVersion(db, {
    seasonId: input.seasonId,
    // Cancelled slots are gone: they are neither reserve nor places to move to.
    input: {
      ...base.input,
      slots: base.input.slots.filter(
        (s) => !cancelled.includes(s.id as SlotId),
      ),
      locked: result.locked,
    },
    schedule: result.schedule,
    origin: "rainout",
    parentVersionId: base.id,
    createdBy: input.actorId,
  });
  await recordAudit(db, {
    actorId: input.actorId,
    action: "rainout.declare",
    entityType: "season",
    entityId: input.seasonId,
    after: {
      date: input.date,
      slotsCancelled: cancelled.length,
      postponed: result.moved.length,
      unplaced: result.moved.filter((m) => m.to === null).length,
      draftVersionId: id,
      builtOn: base.id,
    },
  });
  // A watch or delay on this day gives way to the rain-out.
  await settleDayOnRainout(db, {
    seasonId: input.seasonId,
    date: input.date,
    slotIds: cancelled,
    actorId: input.actorId,
    now: input.now ?? new Date(),
  });
  return ok(id);
}

/**
 * The newest draft that only adds rain-outs and hand edits to the published
 * version, if any: a rain-out declared earlier and not published yet.
 */
async function pendingRainout(
  db: Db,
  versions: readonly {
    id: ScheduleVersionId;
    status: string;
    origin: string;
    parentVersionId: ScheduleVersionId | null;
  }[],
  publishedId: ScheduleVersionId,
): Promise<StoredVersion | null> {
  const byId = new Map(versions.map((v) => [v.id, v]));
  const onTop = (id: ScheduleVersionId | null): boolean => {
    for (let at = id; at; at = byId.get(at)?.parentVersionId ?? null) {
      if (at === publishedId) return true;
      const v = byId.get(at);
      if (!v || (v.origin !== "rainout" && v.origin !== "manual_edit"))
        return false;
    }
    return false;
  };
  const draft = versions.find(
    (v) => v.status === "draft" && v.origin === "rainout" && onTop(v.id),
  );
  return draft ? loadVersion(db, draft.id) : null;
}
