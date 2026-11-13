import { db } from "@/db/client";
import { currentLeague } from "@/db/queries/seasons";
import { storedImage } from "@/db/queries/social";
import { parseId, type SocialImageId } from "@/domain/ids";
import { requirePermission } from "@/lib/auth/permission";
import { imageResponse, notFound } from "@/lib/social/image-response";

/** Any synced photo, hidden ones included, for the admin screen only. */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/app/admin/instagram/photos/[image]">,
): Promise<Response> {
  await requirePermission("photos.manage", { next: "/app/admin/instagram" });
  const id = parseId<SocialImageId>((await ctx.params).image);
  const [image, league] = await Promise.all([
    id ? storedImage(db, id) : null,
    currentLeague(db),
  ]);
  if (!image || image.leagueId !== league?.id) return notFound();
  return imageResponse(image, "private, max-age=300");
}
