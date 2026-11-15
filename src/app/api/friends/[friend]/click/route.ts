import { db } from "@/db/client";
import { countFriendClick } from "@/db/queries/friends";
import { isLinkPing } from "@/domain/friends/clicks";
import { type FriendLeagueId, parseId } from "@/domain/ids";

/**
 * Counts one click out to a directory entry's site. The entry's link on the
 * friends and events pages carries `ping` pointing here, so the browser
 * posts as it follows the link and the visit itself never waits on us.
 * Only the day's count goes up: nothing about who clicked is read or kept.
 * It answers 204 whatever happens, so it says nothing about the directory.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/friends/[friend]/click">,
): Promise<Response> {
  const id = parseId<FriendLeagueId>((await ctx.params).friend);
  if (id && isLinkPing(request.headers))
    await countFriendClick(db, id, new Date().toISOString().slice(0, 10));
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
}
