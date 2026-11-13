import { db } from "@/db/client";
import { merchPhoto } from "@/db/queries/merch";
import { type MerchImageId, parseId } from "@/domain/ids";
import { requirePermission } from "@/lib/auth/permission";
import { imageResponse, notFound } from "@/lib/social/image-response";

/** Any merch photo, a hidden item's included, for the admin screens only. */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/app/admin/merch/photos/[image]">,
): Promise<Response> {
  await requirePermission("merch.manage", { next: "/app/admin/merch" });
  const id = parseId<MerchImageId>((await ctx.params).image);
  const image = id ? await merchPhoto(db, id) : null;
  if (!image) return notFound();
  return imageResponse(image, "private, max-age=300");
}
