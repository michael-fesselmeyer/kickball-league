import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { SeasonCardView } from "@/components/season-card";
import { CopyForWhatsApp, ShareButtons } from "@/components/share";
import { SubmitButton } from "@/components/submit-button";
import { db } from "@/db/client";
import { myCard } from "@/db/queries/season-cards";
import { leagueHref } from "@/domain/league/paths";
import { activeLeague } from "@/lib/league/active";
import {
  publicCardPath,
  seasonCardShareText,
} from "@/domain/season-card/share";
import { env } from "@/env";
import { requirePermission } from "@/lib/auth/permission";
import { absoluteUrl, siteOrigin } from "@/lib/site";
import { setCardPublicAction } from "./actions";

export const metadata: Metadata = { title: "Your season in kickball" };

type Props = PageProps<"/[lang]/app/seasons/[season]/card">;

export default function SeasonCardPage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading your season…</PageLoading>}>
        <Card {...props} />
      </Suspense>
    </main>
  );
}

async function Card({ params, searchParams }: Props) {
  const { season: slug } = await params;
  const query = await searchParams;
  const subject = await requirePermission("registration.join", {
    next: `/app/seasons/${slug}/card`,
  });
  const league = await activeLeague();
  const card = await myCard(db, subject.userId, slug, league?.id);
  if (!card) notFound();
  const own = publicCardPath(card.seasonSlug, card.id);
  const path = league ? leagueHref(league, own) : own;
  const url = absoluteUrl(siteOrigin(env.BETTER_AUTH_URL), path);
  const notice =
    query.shared === "1"
      ? "Your card's link is public. Anyone with it can see your season."
      : query.unshared === "1"
        ? "Your card is private again. Its link no longer works."
        : null;

  return (
    <>
      <Link href="/app" className="self-start underline">
        Home
      </Link>
      {notice && (
        <p role="status" className="rounded-lg border border-success p-3">
          {notice}
        </p>
      )}
      <SeasonCardView stats={card.stats} headingId="card-title" />

      <section aria-labelledby="sharing" className="flex flex-col gap-3">
        <h2 id="sharing" className="text-h2">
          Share your season
        </h2>
        {card.isPublic ? (
          <>
            <p>
              Your card is public: anyone with the link can see it. It shows
              your first name and last initial, your team and your numbers, and
              nobody else&apos;s.
            </p>
            <p className="break-all">
              <Link href={path} className="underline">
                {url}
              </Link>
            </p>
            <ShareButtons
              title="My season in kickball"
              text={seasonCardShareText(card.stats, url)}
            />
            <form action={setCardPublicAction.bind(null, slug, false)}>
              <SubmitButton className="btn btn-secondary">
                Make my card private
              </SubmitButton>
            </form>
          </>
        ) : (
          <>
            <p>
              Only you can see this card. Make its link public to share it with
              a picture in the group chat; you can make it private again any
              time.
            </p>
            <form action={setCardPublicAction.bind(null, slug, true)}>
              <SubmitButton className="btn btn-primary">
                Make my card&apos;s link public
              </SubmitButton>
            </form>
            <CopyForWhatsApp
              text={seasonCardShareText(card.stats, null)}
              about="your season, without a link"
            />
          </>
        )}
      </section>
    </>
  );
}
