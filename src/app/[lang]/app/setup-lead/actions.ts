"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  dayFields,
  recordFieldCheck,
  recordMove,
  setupLeadShifts,
} from "@/db/queries/game-day-checklist";
import { type Action, can } from "@/domain/authz/permissions";
import { parseFieldCheckForm, parseMoveForm } from "@/domain/gameday/checklist";
import { type FieldId, parseId, type SeasonId } from "@/domain/ids";
import { localDay } from "@/domain/schedule/public-game";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { prepareUpload } from "@/lib/books/store-file";
import { activeLeague } from "@/lib/league/active";

const PAGE = "/app/setup-lead";

/**
 * Today's set-up lead for a season, at one of the day's fields, allowed to
 * do `action`; otherwise a 404. Bound arguments come back from the
 * browser, so both ids are checked against today's shifts and fields.
 */
async function leadAt(action: Action, rawSeason: string, rawField: string) {
  const seasonId = parseId<SeasonId>(rawSeason);
  const fieldId = parseId<FieldId>(rawField);
  // Signed in and the site open; then whether they lead set-up today.
  const subject = await requirePermissionToChange("public.view", {
    next: PAGE,
  });
  const league = await activeLeague();
  if (!seasonId || !fieldId || !league) notFound();
  const now = new Date();
  const today = localDay(now, league.timeZone);
  const shift = (
    await setupLeadShifts(db, subject.userId, league.timeZone)
  ).find((s) => s.seasonId === seasonId && s.date === today);
  if (
    !shift ||
    !can(subject, action, { leagueId: shift.leagueId, setupLead: true })
  )
    notFound();
  const field = (await dayFields(db, seasonId, today, league.timeZone)).find(
    (f) => f.fieldId === fieldId,
  );
  if (!field) redirect(`${PAGE}?error=not_field`);
  return {
    userId: subject.userId,
    leagueId: shift.leagueId,
    seasonId,
    field,
    today,
    now,
  };
}

const back = (fieldId: string, query: string) =>
  redirect(`${PAGE}?${query}#field-${fieldId}`);

/** The set-up lead confirms a field was set up inside the permitted area. */
export async function setupCheckAction(
  rawSeason: string,
  rawField: string,
  form: FormData,
): Promise<void> {
  const at = await leadAt("field_check.setup", rawSeason, rawField);
  const parsed = parseFieldCheckForm(form);
  if (!parsed.ok) back(rawField, `error=${parsed.error}`);
  else {
    await txDb.transaction((tx) =>
      recordFieldCheck(tx, {
        seasonId: at.seasonId,
        fieldId: at.field.fieldId,
        date: at.today,
        kind: "setup",
        form: parsed.value,
        photo: null,
        leagueId: at.leagueId,
        actorId: at.userId,
        now: at.now,
      }),
    );
    back(rawField, "notice=setup");
  }
}

/** The set-up lead confirms the field was left clean, or notes a problem. */
export async function closeCheckAction(
  rawSeason: string,
  rawField: string,
  form: FormData,
): Promise<void> {
  const at = await leadAt("field_check.close", rawSeason, rawField);
  const parsed = parseFieldCheckForm(form);
  if (!parsed.ok) back(rawField, `error=${parsed.error}`);
  else {
    const file = form.get("photo");
    let photo = null;
    if (file instanceof Blob && file.size > 0) {
      const prepared = await prepareUpload(file);
      if (!prepared.ok) back(rawField, `error=${prepared.error}`);
      else if (prepared.value.contentType !== "image/webp")
        back(rawField, "error=not_photo");
      else photo = prepared.value;
    }
    const saved = await txDb.transaction((tx) =>
      recordFieldCheck(tx, {
        seasonId: at.seasonId,
        fieldId: at.field.fieldId,
        date: at.today,
        kind: "close",
        form: parsed.value,
        photo,
        leagueId: at.leagueId,
        actorId: at.userId,
        now: at.now,
      }),
    );
    if (!saved.ok) back(rawField, `error=${saved.error}`);
    back(rawField, "notice=closed");
  }
}

/**
 * The set-up lead notes, in one tap, that a group of park users was asked
 * to move and how it went. Anything but "fine" shows on the admins'
 * incidents screen.
 */
export async function moveAction(
  rawSeason: string,
  rawField: string,
  form: FormData,
): Promise<void> {
  const at = await leadAt("move_request.record", rawSeason, rawField);
  const parsed = parseMoveForm(form);
  if (!parsed.ok) back(rawField, `error=${parsed.error}`);
  else {
    await txDb.transaction((tx) =>
      recordMove(tx, {
        seasonId: at.seasonId,
        fieldId: at.field.fieldId,
        form: parsed.value,
        actorId: at.userId,
        now: at.now,
      }),
    );
    back(rawField, `notice=moved_${parsed.value.outcome}`);
  }
}
