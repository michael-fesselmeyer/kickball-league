import { db } from "@/db/client";
import { fieldPermitForGame, permitDocumentForGame } from "@/db/queries/books";
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
 * The permit document for a game, for its ref, both captains and the
 * owners. Never cached by a CDN; the service worker keeps a copy on the
 * phone of someone allowed to see it, with their next game.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/app/games/[game]/permit/document">,
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
  const file = await permitDocumentForGame(db, gameId);
  if (!file) return notFound();
  return privateFileResponse({
    ...file,
    name: `permit-${permit.permitNumber ?? "document"}`.replace(
      /[^A-Za-z0-9-]/g,
      "-",
    ),
  });
}
