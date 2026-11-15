"use server";

import { notFound, redirect } from "next/navigation";
import { txDb } from "@/db/client";
import { activeLeague } from "@/lib/league/active";
import { createShift, deleteShift, updateShift } from "@/db/queries/volunteer";
import { parseId, type VolunteerShiftId } from "@/domain/ids";
import {
  parseShiftForm,
  SHIFT_FORM_ERRORS,
  type ShiftForm,
} from "@/domain/volunteer/shifts";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { formStrings } from "@/lib/form";

export type ShiftFormState = { values: ShiftForm; error: string | null };

const FIELDS = [
  "role",
  "occasion",
  "on",
  "starts",
  "ends",
  "place",
  "notes",
  "spots",
] as const;

const PAGE = "/app/admin/volunteer";

const SAVE_ERRORS = {
  occasion: "That season or event isn't available. Pick another.",
  not_found: "That shift was removed. Go back to the list.",
  too_few_spots:
    "More people have signed up than that. Ask someone to drop the shift first, or keep more spots.",
} as const;

/**
 * An admin posts a shift (no id) or changes one. Values come back with the
 * error, so a failed save keeps what was typed.
 */
export async function saveShiftAction(
  rawShiftId: string | null,
  _previous: ShiftFormState,
  form: FormData,
): Promise<ShiftFormState> {
  const subject = await requirePermissionToChange("volunteer.manage", {
    next: PAGE,
  });
  const league = await activeLeague();
  if (!league) notFound();
  const shiftId =
    rawShiftId === null ? null : parseId<VolunteerShiftId>(rawShiftId);
  if (rawShiftId !== null && !shiftId) notFound();
  const values = formStrings(form, FIELDS);
  const parsed = parseShiftForm(values, league.timeZone);
  if (!parsed.ok) return { values, error: SHIFT_FORM_ERRORS[parsed.error] };
  const saved = await txDb.transaction(async (tx) => {
    if (!shiftId) {
      const created = await createShift(tx, {
        leagueId: league.id,
        shift: parsed.value,
        actorId: subject.userId,
      });
      return created.ok ? null : created.error;
    }
    const updated = await updateShift(tx, {
      id: shiftId,
      leagueId: league.id,
      shift: parsed.value,
      actorId: subject.userId,
    });
    return updated.ok ? null : updated.error;
  });
  if (saved !== null) return { values, error: SAVE_ERRORS[saved] };
  redirect(`${PAGE}?saved=${shiftId ? "updated" : "created"}`);
}

/** An admin removes a shift; everyone on it loses their spot. */
export async function deleteShiftAction(
  rawShiftId: string,
  form: FormData,
): Promise<void> {
  const subject = await requirePermissionToChange("volunteer.manage", {
    next: PAGE,
  });
  const shiftId = parseId<VolunteerShiftId>(rawShiftId);
  const league = await activeLeague();
  if (!shiftId || !league) notFound();
  if (form.get("confirm") !== "yes")
    redirect(`${PAGE}/${shiftId}?error=confirm`);
  const removed = await txDb.transaction((tx) =>
    deleteShift(tx, {
      id: shiftId,
      leagueId: league.id,
      actorId: subject.userId,
    }),
  );
  if (!removed.ok) notFound();
  redirect(`${PAGE}?saved=removed`);
}
