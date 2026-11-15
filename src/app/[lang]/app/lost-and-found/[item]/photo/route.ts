import { db } from "@/db/client";
import { lostFoundPhoto } from "@/db/queries/lost-found";
import { can } from "@/domain/authz/permissions";
import { type LostFoundItemId, parseId } from "@/domain/ids";
import { currentSubject } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";
import { imageResponse } from "@/lib/social/image-response";

const gone = () =>
  new Response("Not found", {
    status: 404,
    headers: { "Cache-Control": "private, no-store" },
  });

/**
 * A lost and found photo, for signed-in members of its league only, and only
 * while the post is open (its photo is deleted when it closes). `?size=thumb`
 * is the small copy the board lists.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/app/lost-and-found/[item]/photo">,
): Promise<Response> {
  const id = parseId<LostFoundItemId>((await ctx.params).item);
  const size =
    new URL(request.url).searchParams.get("size") === "thumb"
      ? "thumb"
      : "full";
  const [subject, photo, league] = await Promise.all([
    currentSubject(),
    id ? lostFoundPhoto(db, id, size) : null,
    activeLeague(),
  ]);
  if (
    !photo ||
    photo.leagueId !== league?.id ||
    !can(subject, "lost_found.use", { leagueId: photo.leagueId })
  ) {
    return gone();
  }
  return imageResponse(photo, "private, no-store");
}
