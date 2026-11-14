"use server";

import { redirect } from "next/navigation";
import { txDb } from "@/db/client";
import { savePicks, setHidden } from "@/db/queries/pickem";
import { type GameId, parseId, type TeamSeasonId } from "@/domain/ids";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { requireFeature } from "@/lib/platform/site";

const PAGE = "/app/pickem";
/** A game day has a handful of games; more fields than this is not a form. */
const MAX_PICKS = 60;

/**
 * Saves the player's picks for the coming game day. Each radio group is
 * named `pick:<game id>` and its value is the team picked to win. Games
 * that have started since the page loaded are refused one by one, and the
 * page says so; the rest are saved.
 */
export async function savePicksAction(form: FormData): Promise<void> {
  await requireFeature("pickem");
  const subject = await requirePermissionToChange("pickem.pick", {
    next: PAGE,
  });
  const picks = new Map<GameId, TeamSeasonId>();
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("pick:") || picks.size >= MAX_PICKS) continue;
    const gameId = parseId<GameId>(key.slice("pick:".length));
    const teamId = parseId<TeamSeasonId>(value);
    if (gameId && teamId) picks.set(gameId, teamId);
  }
  if (picks.size === 0) redirect(`${PAGE}?notice=empty#coming`);
  const result = await txDb.transaction((tx) =>
    savePicks(tx, { userId: subject.userId, picks, now: new Date() }),
  );
  const errors = new Set(result.refused.map((r) => r.error));
  const notice = errors.has("locked")
    ? "locked"
    : errors.has("own_team")
      ? "own_team"
      : errors.size > 0
        ? "not_found"
        : "saved";
  redirect(`${PAGE}?notice=${notice}&saved=${result.saved}#coming`);
}

/** The player hides themselves from the leaderboards, or shows themselves. */
export async function setHiddenAction(hidden: boolean): Promise<void> {
  await requireFeature("pickem");
  const subject = await requirePermissionToChange("pickem.pick", {
    next: PAGE,
  });
  await setHidden(txDb, subject.userId, hidden);
  redirect(`${PAGE}?notice=${hidden ? "hidden" : "shown"}#you`);
}
