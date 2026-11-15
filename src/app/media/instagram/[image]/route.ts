import { db } from "@/db/client";
import { storedImage } from "@/db/queries/social";
import { parseId, type SocialImageId } from "@/domain/ids";
import { photoCacheHeaders, photoSrc } from "@/lib/media/photo-src";
import { imageResponse, notFound } from "@/lib/social/image-response";

/**
 * Our copy of an Instagram photo that public pages show
 * (docs/architecture.md, section 17). A hidden or unfeatured photo answers
 * 404, so hiding one also stops its address working at once: the takedown
 * purges this address's CDN copy and the optimizer's resized copies
 * (ADR 0069), and a copy anywhere else expires within five minutes.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/media/instagram/[image]">,
): Promise<Response> {
  const id = parseId<SocialImageId>((await ctx.params).image);
  if (!id) return notFound();
  const image = await storedImage(db, id);
  if (!image?.shown) return notFound(photoSrc.instagram(id));
  return imageResponse(image, photoCacheHeaders(photoSrc.instagram(id)));
}
