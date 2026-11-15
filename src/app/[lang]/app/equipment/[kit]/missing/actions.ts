"use server";

import { notFound, redirect } from "next/navigation";
import { txDb } from "@/db/client";
import { kitForReport, reportMissing } from "@/db/queries/equipment";
import { can } from "@/domain/authz/permissions";
import { parseMissingForm } from "@/domain/equipment/equipment";
import { type EquipmentKitId, parseId } from "@/domain/ids";
import { requireSelfToChange } from "@/lib/auth/permission";

/**
 * A missing-items report (issue #286), from whoever has the kit, is being
 * handed it or brings it to a game, or from an admin. Admins go back to the
 * kit's page; everyone else to their home screen.
 */
export async function reportMissingAction(
  rawKitId: string,
  form: FormData,
): Promise<void> {
  const page = `/app/equipment/${rawKitId}/missing`;
  const subject = await requireSelfToChange("equipment.carry", page);
  const kitId = parseId<EquipmentKitId>(rawKitId);
  if (!kitId) notFound();
  const kit = await kitForReport(txDb, kitId);
  if (!kit) notFound();
  const parsed = parseMissingForm(
    kit.contents,
    form.getAll("missing"),
    form.get("note"),
  );
  if (!parsed.ok) redirect(`${page}?error=${parsed.error}`);
  const admin = can(subject, "equipment.manage");
  const saved = await txDb.transaction((tx) =>
    reportMissing(tx, {
      ...parsed.value,
      kitId,
      actorId: subject.userId,
      admin,
      now: new Date(),
    }),
  );
  if (!saved.ok) redirect(`${page}?error=${saved.error}`);
  redirect(
    admin
      ? `/app/admin/equipment/${kitId}#reports`
      : "/app?gear_notice=reported#gear",
  );
}
