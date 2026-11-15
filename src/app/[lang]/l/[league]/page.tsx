import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import { InstagramPhotos } from "@/components/instagram-photos";
import { JsonLd } from "@/components/json-ld";
import { Kickball } from "@/components/kickball";
import { revealOrder } from "@/components/motion";
import { db } from "@/db/client";
import { sportLabel } from "@/domain/league/new-league";
import { DEFAULT_LEAGUE_SEGMENT, leagueHref } from "@/domain/league/paths";
import { fill } from "@/i18n/catalog";
import type { Locale } from "@/i18n/locales";
import { localeOf, messagesFor } from "@/i18n/messages";
import { languageAlternates, linkIn } from "@/i18n/routing";
import { cachedLeague, publicLeague } from "@/lib/league/public";
import { LeagueHome } from "./league-home";
import { defaultLeague } from "@/db/queries/leagues";
import { homePhotos } from "@/db/queries/social";
import { env } from "@/env";
import { readUnlessBuildHasNoDatabase } from "@/lib/build-phase";
import { PHOTOS_TAG, PUBLIC_PAGE_LIFE } from "@/lib/public-cache";
import { leagueInfo } from "@/lib/seo/league";
import { leagueJsonLd, websiteJsonLd } from "@/lib/seo/structured-data";
import { SITE, siteOrigin } from "@/lib/site";

/**
 * The page reads its league from the path outside any <Suspense> boundary,
 * so it has no generic fallback shell: a league the build didn't list, or a
 * page an admin's change just expired, is rendered in full before it is
 * served, then kept (as the game page does). Without this, expiring the
 * route makes its next visit fail (ADR 0048).
 */
export const instant = false;

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/l/[league]">): Promise<Metadata> {
  const { league: segment, lang } = await params;
  const locale = localeOf(lang);
  const { home } = messagesFor(locale);
  const league =
    segment === DEFAULT_LEAGUE_SEGMENT ? null : await cachedLeague(segment);
  if (league && !league.isDefault) {
    const path = leagueHref(league, "/");
    return {
      title: { absolute: `${league.name} · ${sportLabel(league.sport)}` },
      description: fill(home.league.description, { league: league.name }),
      alternates: {
        canonical: linkIn(locale, path),
        languages: languageAlternates(path),
      },
    };
  }
  return {
    title: { absolute: fill(home.title, { site: SITE.name }) },
    description: SITE.description,
    alternates: {
      canonical: linkIn(locale, "/"),
      languages: languageAlternates("/"),
    },
  };
}

export default async function Home({
  params,
}: PageProps<"/[lang]/l/[league]">) {
  const { league: segment, lang } = await params;
  const locale = localeOf(lang);
  // The default league's home is the site's own and reads no league data, so
  // it serves even before there is a league (a new site, or the end-to-end
  // tests' server before they seed). Another league gets its own plain home
  // page with its seasons (ADR 0048).
  if (segment !== DEFAULT_LEAGUE_SEGMENT)
    return (
      <LeagueHome league={await publicLeague(segment, "/")} locale={locale} />
    );
  const { home } = messagesFor(locale);
  const href = (path: string) => linkIn(locale, path);
  const facts = [
    { ...home.facts.what },
    { ...home.facts.where, href: "/parks/mccarren-park" },
    { ...home.facts.when, href: "/seasons" },
    { ...home.facts.price, href: "/faq#season" },
  ];
  const ways = [
    home.ways.team,
    home.ways.friend,
    { ...home.ways.solo, href: "/free-agents" },
  ];
  const newHere = [
    { href: "/news/how-to-play-kickball", label: home.newHereLinks.howToPlay },
    { href: "/nyc-kickball-league", label: home.newHereLinks.elsewhere },
    { href: "/free-agents", label: home.newHereLinks.solo },
  ];
  const league = leagueInfo(siteOrigin(env.BETTER_AUTH_URL));
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-16 px-4 py-12 md:px-6 md:py-16">
      <JsonLd
        data={[
          leagueJsonLd(league),
          websiteJsonLd({ name: league.name, url: league.url }),
        ]}
      />
      <section className="flex flex-col gap-8" aria-labelledby="hero">
        <p>
          <span className="sticker">{home.sticker}</span>
        </p>
        <h1 id="hero" className="max-w-[14ch] text-display text-text">
          {home.heroStart} <span className="swipe">{home.heroSwipe}</span>
        </h1>
        <p className="max-w-prose text-body-lg text-text-muted">{home.intro}</p>
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/sign-in" className="btn btn-primary">
            {home.signUp}
          </Link>
          <Link href={href("/faq")} className="btn btn-secondary">
            {home.questions}
          </Link>
          <Kickball className="size-12 rotate-12" />
        </div>
      </section>

      <section aria-labelledby="the-basics" className="flex flex-col gap-6">
        <h2 id="the-basics" className="text-h2">
          {home.basics}
        </h2>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {facts.map((fact, i) => (
            <div
              key={fact.term}
              className="reveal flex min-w-0 flex-col gap-2 rounded-card border-2 border-text bg-surface p-4"
              style={revealOrder(i)}
            >
              <dt className="text-micro font-bold tracking-wider text-text-muted uppercase">
                {fact.term}
              </dt>
              <dd className="flex flex-col gap-2 break-words hyphens-auto">
                <span>{fact.detail}</span>
                {"href" in fact && (
                  <Link
                    href={href(fact.href)}
                    className="font-bold text-brand underline underline-offset-4"
                  >
                    {fact.link}
                  </Link>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="ways-in" className="flex flex-col gap-6">
        <h2 id="ways-in" className="text-h2">
          {home.waysIn}
        </h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {ways.map((way, i) => (
            <li
              key={way.title}
              className="reveal flex min-w-0 flex-col gap-2 rounded-card bg-surface-2 p-4"
              style={revealOrder(i)}
            >
              <span
                aria-hidden="true"
                className="font-display text-h2 font-extrabold text-accent"
              >
                {i + 1}
              </span>
              <h3 className="text-h3 break-words hyphens-auto">{way.title}</h3>
              <p>{way.body}</p>
              {"href" in way && (
                <Link
                  href={href(way.href)}
                  className="font-bold text-brand underline underline-offset-4"
                >
                  {way.link}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section
        aria-labelledby="after"
        className="reveal flex flex-col gap-4 rounded-card border-2 border-text bg-surface p-6 md:p-8"
      >
        <h2 id="after" className="text-h2">
          {home.afterTitle}
        </h2>
        <p className="max-w-prose">{home.afterBody}</p>
        <p>
          <Link
            href={href("/about")}
            className="font-bold text-brand underline underline-offset-4"
          >
            {home.aboutLink}
          </Link>
        </p>
      </section>

      <HomePhotos locale={locale} />

      <section aria-labelledby="new-here" className="flex flex-col gap-4">
        <h2 id="new-here" className="text-h2">
          {home.newHere}
        </h2>
        <ul className="flex flex-col gap-2">
          {newHere.map((link) => (
            <li key={link.href}>
              <Link
                href={href(link.href)}
                className="inline-flex min-h-11 items-center font-bold text-brand underline underline-offset-4"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

/**
 * The default league's latest photos, for the site's own home page,
 * cached with the rest of the page (once per language) and refreshed when
 * an admin curates or the sync brings new ones.
 */
async function HomePhotos({ locale }: { locale: Locale }) {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  cacheTag(PHOTOS_TAG);
  const found = await readUnlessBuildHasNoDatabase(async () => {
    const league = await defaultLeague(db);
    return league ? homePhotos(db, league.id) : null;
  });
  if (!found) return null;
  return (
    <InstagramPhotos
      id="photos"
      heading={messagesFor(locale).home.photos}
      opensPost={messagesFor(locale).home.opensPost}
      cover={found.cover}
      photos={found.photos}
    />
  );
}
