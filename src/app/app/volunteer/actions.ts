"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { currentLeague } from "@/db/queries/seasons";
import { claimShift, dropShift } from "@/db/queries/volunteer";
import { parseId, type VolunteerShiftId } from "@/domain/ids";
import { requirePermissionToChange } from "@/lib/auth/permission";

const PAGE = "/app/volunteer";

/**
 * A member takes a spot on a shift. The spot count, the start time and
 * whether they're on it already are checked by claimShift under the
 * shift's row lock, so the last spot goes to one person.
 */
export async function claimShiftAction(rawShiftId: string): Promise<void> {
  const subject = await requirePermissionToChange("volunteer.claim", {
    next: PAGE,
  });
  const shiftId = parseId<VolunteerShiftId>(rawShiftId);
  const league = await currentLeague(db);
  if (!shiftId || !league) notFound();
  const claimed = await txDb.transaction((tx) =>
    claimShift(tx, {
      shiftId,
      leagueId: league.id,
      userId: subject.userId,
      now: new Date(),
    }),
  );
  if (!claimed.ok) redirect(`${PAGE}?error=${claimed.error}#shift-${shiftId}`);
  redirect(`${PAGE}?notice=claimed#shift-${shiftId}`);
}

/** A member gives their spot back, before the shift starts. */
export async function dropShiftAction(rawShiftId: string): Promise<void> {
  const subject = await requirePermissionToChange("volunteer.claim", {
    next: PAGE,
  });
  const shiftId = parseId<VolunteerShiftId>(rawShiftId);
  if (!shiftId) notFound();
  const dropped = await txDb.transaction((tx) =>
    dropShift(tx, { shiftId, userId: subject.userId, now: new Date() }),
  );
  if (!dropped.ok) redirect(`${PAGE}?error=${dropped.error}#shift-${shiftId}`);
  redirect(`${PAGE}?notice=dropped#shift-${shiftId}`);
}
