import type { Metadata } from "next";
import Link from "next/link";
import { cacheLife, cacheTag } from "next/cache";
import { notFound } from "next/navigation";
import { SeasonCardView } from "@/components/season-card";
import { ShareButtons } from "@/components/share";
import { db } from "@/db/client";
import { publicCard } from "@/db/queries/season-cards";
import { parseId, type SeasonCardId } from "@/domain/ids";
import {
  headline,
  publicCardPath,
  seasonCardShareText,
  seasonShareCard,
} from "@/domain/season-card/share";
import { cardVersion } from "@/domain/share/cards";
import { env } from "@/env";
import {
  PUBLIC_PAGE_LIFE,
  seasonCardsTag,
  seasonCardTag,
} from "@/lib/public-cache";
import { shareMetadata } from "@/lib/share/metadata";
import { absoluteUrl, siteOrigin } from "@/lib/site";
import { NO_CARD, publicCardParams } from "@/lib/static-params";

type Props = PageProps<"/seasons/[season]/card/[card]">;

/** Whole page static, as the standings are (ADR 0029). */
export const ensureStatic = "navigation";

/** Each public card is prerendered at build time; later ones on first visit. */
export async function generateStaticParams() {
  return publicCardParams();
}

/**
 * A card only while its player keeps it public, cached as static HTML
 * (docs/architecture.md, section 3) under the card's tag, which making it
 * public or private expires, and the season's cards tag, which rebuilding
 * the cards expires.
 */
async function cachedCard(season: string, rawId: string) {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  const id = rawId === NO_CARD ? null : parseId<SeasonCardId>(rawId);
  if (!id) return null;
  cacheTag(seasonCardTag(id));
  const card = await publicCard(db, id);
  if (card) cacheTag(seasonCardsTag(card.seasonId));
  return card && card.seasonSlug === season ? card : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { season, card: rawId } = await params;
  const card = await cachedCard(season, rawId);
  // A private card's page says nothing about whose it was.
  if (!card) return { title: "Season card", robots: { index: false } };
  const image = seasonShareCard(card.stats);
  const path = publicCardPath(card.seasonSlug, card.id);
  const title = `${headline(card.stats)} in kickball`;
  const description = `${card.stats.seasonName} with ${card.stats.team.name}: games, runs, streaks and awards.`;
  return {
    title,
    description,
    // Shared on purpose, but a person's card is not for search engines.
    robots: { index: false, follow: false },
    ...shareMetadata({
      title,
      description,
      path,
      image: {
        path: `${path}/share.png?v=${cardVersion(image)}`,
        alt: image.alt,
      },
    }),
  };
}

export default function PublicSeasonCardPage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Card {...props} />
    </main>
  );
}

async function Card({ params }: Props) {
  const { season, card } = await params;
  return <PublicCard season={season} rawId={card} />;
}

/** The whole card, cached as static HTML under the card's tags. */
async function PublicCard({
  season,
  rawId,
}: {
  season: string;
  rawId: string;
}) {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  const card = await cachedCard(season, rawId);
  if (!card) notFound();
  const url = absoluteUrl(
    siteOrigin(env.BETTER_AUTH_URL),
    publicCardPath(card.seasonSlug, card.id),
  );
  return (
    <>
      <SeasonCardView stats={card.stats} headingId="card-title" />
      <section aria-labelledby="share" className="flex flex-col gap-3">
        <h2 id="share" className="text-h2">
          Share this season
        </h2>
        <ShareButtons
          title={`${headline(card.stats)} in kickball`}
          text={seasonCardShareText(card.stats, url)}
        />
      </section>
      <p>
        Want a season like this?{" "}
        <Link href="/seasons" className="underline">
          See the next season and sign up
        </Link>
        .
      </p>
    </>
  );
}
