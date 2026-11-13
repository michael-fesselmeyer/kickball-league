import { db } from "@/db/client";
import { merchPhoto } from "@/db/queries/merch";
import { type MerchImageId, parseId } from "@/domain/ids";
import { imageResponse, notFound } from "@/lib/social/image-response";

/**
 * A photo of a merch item in the shop (docs/architecture.md, section 6).
 * A hidden item's photos answer 404, so hiding an item also stops its
 * photos being served once caches expire, within five minutes here and in
 * the image optimizer.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/media/merch/[image]">,
): Promise<Response> {
  const id = parseId<MerchImageId>((await ctx.params).image);
  const image = id ? await merchPhoto(db, id) : null;
  if (!image?.shown) return notFound();
  return imageResponse(image, "public, max-age=300, s-maxage=300");
}
