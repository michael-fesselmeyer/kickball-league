import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/json-ld";
import { DealList } from "@/components/sponsors/deal-list";
import { TeamOfWeekCard } from "@/components/sponsors/team-of-week";
import { env } from "@/env";
import { breadcrumbJsonLd, sponsorJsonLd } from "@/lib/seo/structured-data";
import { absoluteUrl, siteOrigin } from "@/lib/site";
import {
  NO_SPONSOR,
  publicSponsorParams,
  type LeagueParams,
} from "@/lib/static-params";
import { cachedSponsorDirectory } from "../directory";
import type { LeagueId } from "@/domain/ids";
import { leagueHref } from "@/domain/league/paths";
import { cachedLeague, publicLeague } from "@/lib/league/public";
import { fill } from "@/i18n/catalog";
import { localeOf, messagesFor } from "@/i18n/messages";
import { languageAlternates, linkIn } from "@/i18n/routing";

type Props = PageProps<"/[lang]/l/[league]/sponsors/[sponsor]">;

/**
 * The whole page is static and painted in full (ADR 0029): with no
 * <Suspense> boundary around the sponsor, it is part of the first paint
 * instead of being revealed by a script after a loading state.
 */
export const ensureStatic = "navigation";

/** Every sponsor's page is prerendered at build time and cached. */
export async function generateStaticParams(props: LeagueParams) {
  return publicSponsorParams(props);
}

async function findSponsor(leagueId: LeagueId, slug: string) {
  if (slug === NO_SPONSOR) return null;
  const { sponsors, teamOfWeek } = await cachedSponsorDirectory(leagueId);
  const found = sponsors.find((s) => s.slug === slug);
  return found ? { sponsor: found, teamOfWeek } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { league: segment, sponsor: slug, lang } = await params;
  const locale = localeOf(lang);
  const words = messagesFor(locale).sponsor;
  const league = await cachedLeague(segment);
  const found = league ? await findSponsor(league.id, slug) : null;
  if (!league || !found) return { title: words.title };
  const { sponsor } = found;
  const name = { name: sponsor.name };
  const path = leagueHref(league, `/sponsors/${sponsor.slug}`);
  return {
    title: sponsor.isHomeBar ? fill(words.homeBarTitle, name) : sponsor.name,
    description: sponsor.blurb ?? fill(words.description, name),
    alternates: {
      canonical: linkIn(locale, path),
      languages: languageAlternates(path),
    },
  };
}

export default function SponsorPage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-10 md:px-6">
      <Sponsor {...props} />
    </main>
  );
}

const mapLink = (address: string) =>
  `https://www.openstreetmap.org/search?query=${encodeURIComponent(address)}`;

async function Sponsor({ params }: Props) {
  const { league: segment, sponsor: slug, lang } = await params;
  const locale = localeOf(lang);
  const words = messagesFor(locale).sponsor;
  const league = await publicLeague(segment, `/sponsors/${slug}`);
  const href = (path: string) => linkIn(locale, leagueHref(league, path));
  const found = await findSponsor(league.id, slug);
  if (!found) notFound();
  const { sponsor, teamOfWeek } = found;
  const origin = siteOrigin(env.BETTER_AUTH_URL);
  const url = absoluteUrl(origin, href(`/sponsors/${sponsor.slug}`));
  // The team of the week shows on the page of the sponsor that put up the
  // tab, or on the home bar's page when nobody did.
  const honor =
    teamOfWeek &&
    (teamOfWeek.sponsorSlug === sponsor.slug ||
      (teamOfWeek.sponsorSlug === null && sponsor.isHomeBar))
      ? teamOfWeek
      : null;
  const hasPremises = sponsor.kind === "bar" || sponsor.kind === "restaurant";

  return (
    <>
      <JsonLd
        data={[
          sponsorJsonLd({
            name: sponsor.name,
            kind: sponsor.kind,
            url,
            sameAs: sponsor.url ?? undefined,
            address: sponsor.address ?? undefined,
            description: sponsor.blurb ?? undefined,
          }),
          breadcrumbJsonLd([
            { name: words.home, url: absoluteUrl(origin, href("/")) },
            {
              name: words.sponsors,
              url: absoluteUrl(origin, href("/sponsors")),
            },
            { name: sponsor.name, url },
          ]),
        ]}
      />
      <header className="flex flex-col gap-3">
        <p className="text-small">
          <Link href={href("/sponsors")} className="underline">
            {words.sponsors}
          </Link>
        </p>
        {sponsor.isHomeBar && (
          <p>
            <span className="sticker">{words.homeBar}</span>
          </p>
        )}
        <h1 className="text-h1">{sponsor.name}</h1>
        {sponsor.blurb && (
          <p className="text-body-lg text-text-muted">{sponsor.blurb}</p>
        )}
        {(sponsor.address || sponsor.url) && (
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-small">
            {sponsor.address && (
              <li>
                <address className="inline not-italic">
                  {sponsor.address}
                </address>{" "}
                ·{" "}
                <a
                  href={mapLink(sponsor.address)}
                  className="inline-flex min-h-6 items-center underline"
                  rel="noopener"
                >
                  {words.map}
                </a>
              </li>
            )}
            {sponsor.url && (
              <li>
                <a
                  href={sponsor.url}
                  className="inline-flex min-h-6 items-center underline"
                  rel="noopener"
                >
                  {words.website}
                </a>
              </li>
            )}
          </ul>
        )}
      </header>

      {honor && (
        <TeamOfWeekCard
          league={league}
          honor={honor}
          linkSponsor={false}
          locale={locale}
        />
      )}

      <section aria-labelledby="deals" className="flex flex-col gap-4">
        <h2 id="deals" className="text-h2">
          {words.deals}
        </h2>
        <DealList deals={sponsor.deals} locale={locale} />
      </section>

      {hasPremises && (
        <section aria-labelledby="check-in" className="flex flex-col gap-3">
          <h2 id="check-in" className="text-h2">
            {words.checkInTitle}
          </h2>
          <ol className="flex list-decimal flex-col gap-2 pl-5">
            <li>{words.stepCode}</li>
            <li>{words.stepScan}</li>
            <li>{words.stepDeal}</li>
          </ol>
          <p className="text-small text-text-muted">
            {fill(words.checkInNote, { name: sponsor.name })}
          </p>
        </section>
      )}
    </>
  );
}
