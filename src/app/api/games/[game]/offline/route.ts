import { db, txDb } from "@/db/client";
import { hasReferee } from "@/db/queries/live-scores";
import { applyOfflineEntry } from "@/db/queries/offline-scores";
import { gameForScoring } from "@/db/queries/scores";
import { can } from "@/domain/authz/permissions";
import { type GameId, parseId } from "@/domain/ids";
import type { OfflineResult } from "@/domain/scores/offline";
import { parseOfflineEntry } from "@/domain/scores/offline-entry";
import { permissionToChange } from "@/lib/auth/permission";
import { expireGameScore } from "@/lib/public-cache";
import { sendQueuedSoon } from "@/services/outbox";

/**
 * Receives a score entry saved on a phone with no signal, once the signal
 * is back (docs/architecture.md, section 14; ADR 0025). The service worker
 * sends it, so this answers in JSON instead of redirecting like the score
 * screen's Server Actions, with the same permission and paused-site checks.
 *
 * - 200: the entry is done with; the body says what happened to it.
 * - 400: the entry can't be read, and never will be.
 * - 401 and 423: signed out, or the site is paused; send it again later.
 */

const answer = (result: OfflineResult, status = 200) =>
  Response.json(result, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

const refused = (message: string, status = 200) =>
  answer({ status: "refused", message }, status);

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/games/[game]/offline">,
) {
  // Only this site's own pages and worker post here: a form on another
  // site can't send JSON, and browsers mark a cross-site fetch.
  const site = request.headers.get("sec-fetch-site");
  if (
    !request.headers.get("content-type")?.startsWith("application/json") ||
    (site !== null && site !== "same-origin")
  )
    return refused("This entry couldn't be read.", 400);
  const gameId = parseId<GameId>((await ctx.params).game);
  const entry = parseOfflineEntry(await request.json().catch(() => null));
  if (!gameId || !entry || entry.gameId !== gameId)
    return refused("This entry couldn't be read.", 400);

  const allowed = await permissionToChange("public.view");
  if (!allowed.ok)
    return allowed.error === "signed_out"
      ? refused("Sign in to send it.", 401)
      : allowed.error === "frozen"
        ? refused("The league's site is paused. It will send later.", 423)
        : refused("You can't score this game.");
  const subject = allowed.value;
  if (entry.userId !== subject.userId)
    return refused("Someone else saved this on this phone, so it wasn't sent.");
  const g = await gameForScoring(db, gameId);
  if (!g) return refused("That game is gone.");
  const game = { id: g.id, teamSeasonIds: [g.teamAId, g.teamBId] as const };
  const may =
    entry.kind === "score"
      ? can(subject, "score.enter", { game })
      : can(subject, "score.live", {
          game: { ...game, hasReferee: await hasReferee(db, g.id) },
        });
  if (!may) return refused("You can't score this game.");

  // How a final score from this person counts, as on the score screens.
  const team = game.teamSeasonIds.find((t) =>
    subject.roster.some(
      (m) =>
        m.teamSeasonId === t &&
        (m.role === "captain" || m.role === "co_captain"),
    ),
  );
  const role =
    entry.kind === "score"
      ? subject.globalRole === "admin" || subject.globalRole === "owner"
        ? "admin"
        : team
          ? "captain"
          : "referee"
      : can(subject, "score.override")
        ? "admin"
        : subject.refereeGameIds.includes(g.id)
          ? "referee"
          : "captain";

  const applied = await txDb.transaction((tx) =>
    applyOfflineEntry(tx, {
      entry,
      g,
      userId: subject.userId,
      role,
      teamSeasonId: role === "captain" ? (team ?? null) : null,
      now: new Date(),
    }),
  );
  if (applied.changed) {
    expireGameScore(g.seasonId, g.id);
    // A new report asks the other captain to confirm it.
    if (entry.kind !== "half") sendQueuedSoon();
  }
  return answer(applied.result);
}
