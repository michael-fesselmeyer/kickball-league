import { db } from "@/db/client";
import { memberPhotoFile } from "@/db/queries/member-photos";
import { type MemberPhotoId, parseId } from "@/domain/ids";
import { photoCacheHeaders, photoSrc } from "@/lib/media/photo-src";
import { imageResponse, notFound } from "@/lib/social/image-response";

/**
 * A member's approved photo, for the public team, event and game pages
 * (ADR 0039). A waiting, rejected or deleted photo answers 404, so taking
 * one down also stops its address working at once: the takedown purges this
 * address's CDN copy and the optimizer's resized copies (ADR 0069), and a
 * copy anywhere else expires within five minutes.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/media/photos/[photo]">,
): Promise<Response> {
  const id = parseId<MemberPhotoId>((await ctx.params).photo);
  if (!id) return notFound();
  const photo = await memberPhotoFile(db, id);
  if (photo?.status !== "approved") return notFound(photoSrc.member(id));
  return imageResponse(photo, photoCacheHeaders(photoSrc.member(id)));
}
