import { db } from "@/db/client";
import { storedFriendLogo } from "@/db/queries/friends";
import { type FriendLogoId, parseId } from "@/domain/ids";
import { imageResponse, notFound } from "@/lib/social/image-response";

/**
 * A friend league's logo, as the public directory shows it
 * (docs/architecture.md, section 17). A new upload gets a new id, so a copy
 * can be kept for a day; a removed logo answers 404 once caches expire.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/media/friends/[logo]">,
): Promise<Response> {
  const id = parseId<FriendLogoId>((await ctx.params).logo);
  const logo = id ? await storedFriendLogo(db, id) : null;
  if (!logo) return notFound();
  return imageResponse(logo, "public, max-age=86400, s-maxage=86400");
}
