import { db } from "@/db/client";
import { merchPhoto } from "@/db/queries/merch";
import { type MerchImageId, parseId } from "@/domain/ids";
import { photoCacheHeaders, photoSrc } from "@/lib/media/photo-src";
import { imageResponse, notFound } from "@/lib/social/image-response";

/**
 * A photo of a merch item in the shop (docs/architecture.md, section 6).
 * A hidden item's photos answer 404, so hiding an item also stops its
 * photos being served at once: hiding purges this address's CDN copy and the
 * optimizer's resized copies (ADR 0064), and a copy anywhere else expires
 * within five minutes.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/media/merch/[image]">,
): Promise<Response> {
  const id = parseId<MerchImageId>((await ctx.params).image);
  if (!id) return notFound();
  const image = await merchPhoto(db, id);
  if (!image?.shown) return notFound(photoSrc.merch(id));
  return imageResponse(image, photoCacheHeaders(photoSrc.merch(id)));
}
