"use server";

import { notFound, redirect } from "next/navigation";
import { db } from "@/db/client";
import { attendanceGame, checkInByScan } from "@/db/queries/attendance";
import { isCurrentFieldCode, scanOpen } from "@/domain/attendance/attendance";
import { type GameId, parseId, type UserId } from "@/domain/ids";
import { env } from "@/env";
import { requirePermissionToChange } from "@/lib/auth/permission";

/**
 * A player checks in for a game they're at, from the code shown at the
 * field (ADR 0063). The code, the game day and the roster are all checked
 * again here, not only when the page showed the button, so a link preview
 * or a stale tab never checks anyone in.
 */
export async function checkInForGameAction(
  rawGameId: string,
  code: string,
): Promise<void> {
  const page = `/app/games/${rawGameId}/check-in/${code}`;
  const subject = await requirePermissionToChange("attendance.check_in", {
    next: page,
  });
  const gameId = parseId<GameId>(rawGameId);
  const userId = parseId<UserId>(subject.userId);
  const g = gameId ? await attendanceGame(db, gameId) : null;
  if (!g || !userId) notFound();
  const now = new Date();
  if (!scanOpen(g, now).ok) redirect(`${page}?error=closed`);
  if (!isCurrentFieldCode(env.BETTER_AUTH_SECRET, g.id, code, now))
    redirect(`${page}?error=expired`);
  const result = await checkInByScan(db, { game: g, userId, now });
  if (!result.ok) redirect(`${page}?error=not_playing`);
  redirect(`${page}?done=1`);
}
