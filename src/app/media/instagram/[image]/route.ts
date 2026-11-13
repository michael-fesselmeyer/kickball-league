import { db } from "@/db/client";
import { storedImage } from "@/db/queries/social";
import { parseId, type SocialImageId } from "@/domain/ids";
import { imageResponse, notFound } from "@/lib/social/image-response";

/**
 * Our copy of an Instagram photo that public pages show
 * (docs/architecture.md, section 17). A hidden or unfeatured photo answers
 * 404, so hiding one also stops its address working once caches expire,
 * within five minutes here and in the image optimizer.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/media/instagram/[image]">,
): Promise<Response> {
  const id = parseId<SocialImageId>((await ctx.params).image);
  const image = id ? await storedImage(db, id) : null;
  if (!image?.shown) return notFound();
  return imageResponse(image, "public, max-age=300, s-maxage=300");
}
