"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  checklistGame,
  recordFieldCheck,
} from "@/db/queries/game-day-checklist";
import { parseFieldCheckForm } from "@/domain/gameday/checklist";
import { type GameId, parseId } from "@/domain/ids";
import { localDay } from "@/domain/schedule/public-game";
import { can } from "@/domain/authz/permissions";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { prepareUpload } from "@/lib/books/store-file";
import { leadsSetupOn } from "@/lib/gameday/setup-lead";

/**
 * After the last game at a field, its ref, a captain or the set-up lead
 * confirms the field was left clean, or notes a problem, with an optional
 * photo (issue #409). Saving again replaces the earlier check.
 */
export async function closeFieldAction(
  rawGameId: string,
  form: FormData,
): Promise<void> {
  const page = `/app/games/${rawGameId}/checklist`;
  const gameId = parseId<GameId>(rawGameId);
  const g = gameId ? await checklistGame(db, gameId) : null;
  if (!g || !g.lastOnField) notFound();
  // Signed in and the site open; then whether this person may close the
  // field, which depends on whether they lead set-up that day.
  const subject = await requirePermissionToChange("public.view", {
    next: page,
  });
  const allowed = can(subject, "field_check.close", {
    leagueId: g.leagueId,
    game: { id: g.id, teamSeasonIds: g.teamSeasonIds },
    setupLead: await leadsSetupOn(subject, g),
  });
  if (!allowed) notFound();
  const now = new Date();
  const back = (query: string) => redirect(`${page}?${query}#close`);
  if (localDay(now, g.timeZone) !== g.date) back("error=not_today");

  const parsed = parseFieldCheckForm(form);
  if (!parsed.ok) back(`error=${parsed.error}`);
  else {
    const file = form.get("photo");
    let photo = null;
    if (file instanceof Blob && file.size > 0) {
      const prepared = await prepareUpload(file);
      if (!prepared.ok) back(`error=${prepared.error}`);
      else if (prepared.value.contentType !== "image/webp")
        back("error=not_photo");
      else photo = prepared.value;
    }
    const saved = await txDb.transaction((tx) =>
      recordFieldCheck(tx, {
        seasonId: g.seasonId,
        fieldId: g.fieldId,
        date: g.date,
        kind: "close",
        form: parsed.value,
        photo,
        leagueId: g.leagueId,
        actorId: subject.userId,
        now,
      }),
    );
    if (!saved.ok) back(`error=${saved.error}`);
    back("notice=closed");
  }
}
