import { db } from "@/db/client";
import { checklistGame, setTick } from "@/db/queries/game-day-checklist";
import { parseTick } from "@/domain/gameday/checklist";
import { type GameId, parseId } from "@/domain/ids";
import { localDay } from "@/domain/schedule/public-game";
import { permissionToChange } from "@/lib/auth/permission";

/**
 * A captain ticks or unticks one game-day checklist item for their team
 * (issue #409). The checklist page sends it at once, or, with no signal,
 * keeps it on the phone and sends it when the signal is back; so this
 * answers in JSON, like the offline score route.
 *
 * - 200: saved, or refused for good (the body says which).
 * - 400: the tick can't be read.
 * - 401 and 423: signed out, or the site is paused; send it again later.
 */

const answer = (body: { ok: boolean; message?: string }, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/games/[game]/checklist">,
) {
  // Only this site's own pages post here: a form on another site can't
  // send JSON, and browsers mark a cross-site fetch.
  const site = request.headers.get("sec-fetch-site");
  if (
    !request.headers.get("content-type")?.startsWith("application/json") ||
    (site !== null && site !== "same-origin")
  )
    return answer({ ok: false }, 400);
  const gameId = parseId<GameId>((await ctx.params).game);
  const tick = parseTick(await request.json().catch(() => null));
  if (!gameId || !tick) return answer({ ok: false }, 400);

  const g = await checklistGame(db, gameId);
  if (!g || !g.teams.some((t) => t.id === tick.teamSeasonId))
    return answer({ ok: false, message: "That game is gone." });
  const allowed = await permissionToChange("game_checklist.tick", {
    leagueId: g.leagueId,
    teamSeasonId: tick.teamSeasonId,
  });
  if (!allowed.ok)
    return allowed.error === "signed_out"
      ? answer({ ok: false, message: "Sign in to save it." }, 401)
      : allowed.error === "frozen"
        ? answer({ ok: false, message: "The site is paused." }, 423)
        : answer({ ok: false, message: "Only the team's captains tick." });
  const now = new Date();
  // From the game's day on: a tick kept offline may arrive after midnight.
  if (localDay(now, g.timeZone) < g.date)
    return answer({ ok: false, message: "The checklist opens on game day." });
  const saved = await setTick(db, {
    game: g,
    teamSeasonId: tick.teamSeasonId,
    itemId: tick.itemId,
    on: tick.on,
    actorId: allowed.value.userId,
    now,
  });
  return saved === "saved"
    ? answer({ ok: true })
    : answer({ ok: false, message: "The checklist changed. Reload it." });
}
