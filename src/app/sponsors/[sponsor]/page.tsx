import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { JsonLd } from "@/components/json-ld";
import { PageLoading } from "@/components/page-loading";
import { DealList } from "@/components/sponsors/deal-list";
import { TeamOfWeekCard } from "@/components/sponsors/team-of-week";
import { env } from "@/env";
import { breadcrumbJsonLd, sponsorJsonLd } from "@/lib/seo/structured-data";
import { absoluteUrl, siteOrigin } from "@/lib/site";
import { NO_SPONSOR, publicSponsorParams } from "@/lib/static-params";
import { cachedSponsorDirectory } from "../directory";

type Props = PageProps<"/sponsors/[sponsor]">;

/** Every sponsor's page is prerendered at build time and cached. */
export async function generateStaticParams() {
  return publicSponsorParams();
}

async function findSponsor(slug: string) {
  if (slug === NO_SPONSOR) return null;
  const { sponsors, teamOfWeek } = await cachedSponsorDirectory();
  const found = sponsors.find((s) => s.slug === slug);
  return found ? { sponsor: found, teamOfWeek } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { sponsor: slug } = await params;
  const found = await findSponsor(slug);
  if (!found) return { title: "Sponsor" };
  const { sponsor } = found;
  return {
    title: sponsor.isHomeBar
      ? `${sponsor.name}, the league's home bar`
      : sponsor.name,
    description:
      sponsor.blurb ??
      `${sponsor.name} backs the league. Deals for players and how to check in.`,
    alternates: { canonical: `/sponsors/${sponsor.slug}` },
  };
}

export default function SponsorPage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-10 md:px-6">
      <Suspense fallback={<PageLoading>Loading the sponsor…</PageLoading>}>
        <Sponsor {...props} />
      </Suspense>
    </main>
  );
}

const mapLink = (address: string) =>
  `https://www.openstreetmap.org/search?query=${encodeURIComponent(address)}`;

async function Sponsor({ params }: Props) {
  const { sponsor: slug } = await params;
  const found = await findSponsor(slug);
  if (!found) notFound();
  const { sponsor, teamOfWeek } = found;
  const origin = siteOrigin(env.BETTER_AUTH_URL);
  const url = absoluteUrl(origin, `/sponsors/${sponsor.slug}`);
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
            { name: "Home", url: absoluteUrl(origin, "/") },
            { name: "Sponsors", url: absoluteUrl(origin, "/sponsors") },
            { name: sponsor.name, url },
          ]),
        ]}
      />
      <header className="flex flex-col gap-3">
        <p className="text-small">
          <Link href="/sponsors" className="underline">
            Sponsors
          </Link>
        </p>
        {sponsor.isHomeBar && (
          <p>
            <span className="sticker">The league&apos;s home bar</span>
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
                  Map
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
                  Website
                </a>
              </li>
            )}
          </ul>
        )}
      </header>

      {honor && <TeamOfWeekCard honor={honor} linkSponsor={false} />}

      <section aria-labelledby="deals" className="flex flex-col gap-4">
        <h2 id="deals" className="text-h2">
          Deals for players
        </h2>
        <DealList deals={sponsor.deals} />
      </section>

      {hasPremises && (
        <section aria-labelledby="check-in" className="flex flex-col gap-3">
          <h2 id="check-in" className="text-h2">
            Check in when you get there
          </h2>
          <ol className="flex list-decimal flex-col gap-2 pl-5">
            <li>
              Find the league&apos;s code on the screen by the door or the
              register. It changes every few minutes.
            </li>
            <li>Scan it with your phone&apos;s camera and tap Check in.</li>
            <li>
              Pick a deal if you want one and show the screen to whoever serves
              you.
            </li>
          </ol>
          <p className="text-small text-text-muted">
            Check-ins show {sponsor.name} how many of us came by, which keeps
            the deals coming. One a day counts, and you never have to order
            anything.
          </p>
        </section>
      )}
    </>
  );
}
