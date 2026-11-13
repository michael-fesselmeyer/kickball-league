import { db } from "@/db/client";
import { memberPhotoFile } from "@/db/queries/member-photos";
import { type MemberPhotoId, parseId } from "@/domain/ids";
import { imageResponse, notFound } from "@/lib/social/image-response";

/**
 * A member's approved photo, for the public team, event and game pages
 * (ADR 0035). A waiting, rejected or deleted photo answers 404, so taking
 * one down also stops its address working once caches expire, within five
 * minutes here and in the image optimizer.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/media/photos/[photo]">,
): Promise<Response> {
  const id = parseId<MemberPhotoId>((await ctx.params).photo);
  const photo = id ? await memberPhotoFile(db, id) : null;
  if (photo?.status !== "approved") return notFound();
  return imageResponse(photo, "public, max-age=300, s-maxage=300");
}
