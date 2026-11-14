import { db } from "@/db/client";
import { publicCard } from "@/db/queries/season-cards";
import { parseId, type SeasonCardId } from "@/domain/ids";
import { seasonShareCard } from "@/domain/season-card/share";
import { renderShareImage } from "@/lib/share/image";

/**
 * A public season card's share image. Cached for a minute only: when the
 * player makes the card private again, the image goes with it.
 */
const CARD_IMAGE_CACHE = "public, max-age=60, s-maxage=60";

const notFound = () =>
  new Response("No public card here.", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });

export async function GET(
  _request: Request,
  ctx: RouteContext<"/seasons/[season]/card/[card]/share.png">,
) {
  const { season, card: rawId } = await ctx.params;
  const id = parseId<SeasonCardId>(rawId);
  const card = id ? await publicCard(db, id) : null;
  if (!card || card.seasonSlug !== season) return notFound();
  return renderShareImage(seasonShareCard(card.stats), {
    cacheControl: CARD_IMAGE_CACHE,
  });
}
