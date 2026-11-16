import { db } from "@/db/client";
import { fieldPermitForGame } from "@/db/queries/books";
import { layoutFileForGame } from "@/db/queries/field-layouts";
import { can } from "@/domain/authz/permissions";
import { type GameId, parseId } from "@/domain/ids";
import { currentSubject } from "@/lib/auth/permission";
import { privateFileResponse } from "@/lib/books/store-file";

const notFound = () =>
  new Response("Not found.", {
    status: 404,
    headers: { "Cache-Control": "private, no-store" },
  });

/**
 * The layout of the field a game is played on, for its ref, both captains
 * and the owners, as the permit document is. Never cached by a CDN; the
 * service worker keeps a copy on the phone with the next game.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/[lang]/app/games/[game]/permit/layout">,
) {
  const subject = await currentSubject();
  const { game } = await ctx.params;
  const gameId = parseId<GameId>(game);
  if (!gameId) return notFound();
  const permit = await fieldPermitForGame(db, gameId);
  if (
    !permit ||
    !can(subject, "permit.view_at_field", {
      game: { id: gameId, teamSeasonIds: [permit.teamAId, permit.teamBId] },
    })
  )
    return notFound();
  const file = await layoutFileForGame(db, gameId);
  if (!file) return notFound();
  return privateFileResponse({
    ...file,
    name: `layout-${permit.fieldName}`.replace(/[^A-Za-z0-9-]/g, "-"),
  });
}
