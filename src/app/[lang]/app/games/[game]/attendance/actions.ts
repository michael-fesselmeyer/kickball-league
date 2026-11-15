"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  attendanceGame,
  gameAttendanceList,
  saveAttendance,
} from "@/db/queries/attendance";
import {
  attendanceChanges,
  markOpen,
  parseMarks,
} from "@/domain/attendance/attendance";
import { can } from "@/domain/authz/permissions";
import { type GameId, parseId, type UserId } from "@/domain/ids";
import { requirePermissionToChange } from "@/lib/auth/permission";

const strings = (form: FormData, name: string) =>
  form.getAll(name).filter((v): v is string => typeof v === "string");

/**
 * A captain, the ref or an admin saves who played. Only the people the form
 * showed as checked in (`was`) can be taken off, so a player who scans while
 * the captain is ticking stays checked in.
 */
export async function saveAttendanceAction(
  rawGameId: string,
  form: FormData,
): Promise<void> {
  const page = `/app/games/${rawGameId}/attendance`;
  const gameId = parseId<GameId>(rawGameId);
  const g = gameId ? await attendanceGame(db, gameId) : null;
  if (!g) notFound();
  const subject = await requirePermissionToChange("attendance.take", {
    next: page,
    game: { id: g.id, teamSeasonIds: [g.teamAId, g.teamBId] },
  });
  const actorId = parseId<UserId>(subject.userId);
  if (!actorId) notFound();
  const now = new Date();
  const open = markOpen(g, now, can(subject, "score.override"));
  if (!open.ok) redirect(`${page}?error=${open.error}`);
  const people = await gameAttendanceList(db, g);
  const choices = new Set<string>(people.map((p) => p.userId));
  const wanted = parseMarks(strings(form, "played"), choices);
  const shown = parseMarks(strings(form, "was"), choices);
  if (!wanted.ok || !shown.ok) redirect(`${page}?error=unknown_person`);
  const current = new Set<string>(
    people.filter((p) => p.checkedIn).map((p) => p.userId),
  );
  const { add, remove } = attendanceChanges(current, wanted.value);
  const saved = await txDb.transaction((tx) =>
    saveAttendance(tx, {
      gameId: g.id,
      people,
      add,
      remove: remove.filter((id) => shown.value.has(id)),
      actorId,
      now,
    }),
  );
  redirect(`${page}?saved=${saved.added + saved.removed}`);
}
