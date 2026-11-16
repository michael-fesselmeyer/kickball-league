import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { DealList } from "@/components/sponsors/deal-list";
import { TeamOfWeekCard } from "@/components/sponsors/team-of-week";
import { cachedSponsorDirectory } from "./directory";
import { leagueHref } from "@/domain/league/paths";
import { cachedLeague, publicLeague } from "@/lib/league/public";
import { plural } from "@/i18n/catalog";
import { localeOf, messagesFor } from "@/i18n/messages";
import { languageAlternates, linkIn } from "@/i18n/routing";

type Props = PageProps<"/[lang]/l/[league]/sponsors">;

/**
 * The page reads its language from the path outside its <Suspense>
 * boundary, so its heading and loading words are in that language from the
 * first paint (ADR 0065). Every league and language is listed at build, so
 * it is still prerendered; only a navigation into a page the build didn't
 * list waits for it, as on the rules page.
 */
export const instant = false;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, league: segment } = await params;
  const locale = localeOf(lang);
  const { title, description } = messagesFor(locale).sponsors;
  const league = await cachedLeague(segment);
  const path = league ? leagueHref(league, "/sponsors") : "/sponsors";
  return {
    title,
    description,
    alternates: {
      canonical: linkIn(locale, path),
      languages: languageAlternates(path),
    },
  };
}

export default async function SponsorsPage({ params }: Props) {
  const words = messagesFor(localeOf((await params).lang)).sponsors;
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 py-10 md:px-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-h1">
          {words.headingStart}{" "}
          <span className="swipe">{words.headingSwipe}</span>
        </h1>
        <p className="text-body-lg text-text-muted">{words.intro}</p>
      </header>
      <Suspense fallback={<PageLoading>{words.loading}</PageLoading>}>
        <Sponsors params={params} />
      </Suspense>
    </main>
  );
}

async function Sponsors({ params }: { params: Props["params"] }) {
  const { lang, league: segment } = await params;
  const locale = localeOf(lang);
  const words = messagesFor(locale).sponsors;
  const league = await publicLeague(segment, "/sponsors");
  const href = (path: string) => linkIn(locale, leagueHref(league, path));
  const { sponsors, teamOfWeek } = await cachedSponsorDirectory(league.id);
  const home = sponsors.find((s) => s.isHomeBar);
  const others = sponsors.filter((s) => !s.isHomeBar);
  return (
    <>
      {teamOfWeek && (
        <TeamOfWeekCard league={league} honor={teamOfWeek} locale={locale} />
      )}
      {home && (
        <section
          aria-labelledby="home-bar"
          className="flex flex-col gap-4 rounded-card border border-border bg-surface p-5 shadow-card"
        >
          <p>
            <span className="sticker">{words.homeBase}</span>
          </p>
          <h2 id="home-bar" className="font-display text-h2">
            <Link
              href={href(`/sponsors/${home.slug}`)}
              className="inline-flex min-h-6 items-center underline"
            >
              {home.name}
            </Link>
          </h2>
          {home.blurb && <p>{home.blurb}</p>}
          {home.address && (
            <address className="text-small text-text-muted not-italic">
              {home.address}
            </address>
          )}
          <DealList deals={home.deals} locale={locale} />
        </section>
      )}
      {others.length > 0 && (
        <section aria-labelledby="also" className="flex flex-col gap-4">
          <h2 id="also" className="text-h2">
            {home ? words.also : words.backing}
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {others.map((s) => (
              <li
                key={s.id}
                className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4 shadow-card"
              >
                <p className="text-micro font-bold tracking-wide text-text-muted uppercase">
                  {words.kinds[s.kind]}
                </p>
                <h3 className="font-display text-h3">
                  <Link
                    href={href(`/sponsors/${s.slug}`)}
                    className="inline-flex min-h-6 items-center underline"
                  >
                    {s.name}
                  </Link>
                </h3>
                {s.blurb && <p className="text-small">{s.blurb}</p>}
                {s.deals.length > 0 && (
                  <p className="text-small text-text-muted">
                    {plural(locale, words.deals, s.deals.length)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {sponsors.length === 0 && (
        <p className="text-text-muted">
          {words.onTheWay}{" "}
          <Link href={linkIn(locale, "/about")} className="underline">
            {words.getInTouch}
          </Link>
          .
        </p>
      )}
    </>
  );
}
