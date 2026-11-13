import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { DealList } from "@/components/sponsors/deal-list";
import { TeamOfWeekCard } from "@/components/sponsors/team-of-week";
import type { PublicSponsor } from "@/db/queries/sponsors";
import { cachedSponsorDirectory } from "./directory";

export const metadata: Metadata = {
  title: "Sponsors and the home bar",
  description:
    "The businesses behind the league, where everyone heads after games, this week's deals and the team of the week.",
  alternates: { canonical: "/sponsors" },
};

export default function SponsorsPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 py-10 md:px-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-h1">
          Our <span className="swipe">sponsors</span>
        </h1>
        <p className="text-body-lg text-text-muted">
          The local spots that keep the league going. After the last out,
          everyone heads to the home bar. Check in when you get there, and use a
          deal if one suits you. Deals are a bonus, never a requirement.
        </p>
      </header>
      <Suspense fallback={<PageLoading>Loading the sponsors…</PageLoading>}>
        <Sponsors />
      </Suspense>
    </main>
  );
}

const KIND: Record<PublicSponsor["kind"], string> = {
  bar: "Bar",
  restaurant: "Restaurant",
  brand: "Brand",
  other: "Sponsor",
};

async function Sponsors() {
  const { sponsors, teamOfWeek } = await cachedSponsorDirectory();
  const home = sponsors.find((s) => s.isHomeBar);
  const others = sponsors.filter((s) => !s.isHomeBar);
  return (
    <>
      {teamOfWeek && <TeamOfWeekCard honor={teamOfWeek} />}
      {home && (
        <section
          aria-labelledby="home-bar"
          className="flex flex-col gap-4 rounded-card border border-border bg-surface p-5 shadow-card"
        >
          <p>
            <span className="sticker">Home base after games</span>
          </p>
          <h2 id="home-bar" className="font-display text-h2">
            <Link
              href={`/sponsors/${home.slug}`}
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
          <DealList deals={home.deals} />
        </section>
      )}
      {others.length > 0 && (
        <section aria-labelledby="also" className="flex flex-col gap-4">
          <h2 id="also" className="text-h2">
            {home ? "Also backing the league" : "Backing the league"}
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {others.map((s) => (
              <li
                key={s.id}
                className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4 shadow-card"
              >
                <p className="text-micro font-bold tracking-wide text-text-muted uppercase">
                  {KIND[s.kind]}
                </p>
                <h3 className="font-display text-h3">
                  <Link
                    href={`/sponsors/${s.slug}`}
                    className="inline-flex min-h-6 items-center underline"
                  >
                    {s.name}
                  </Link>
                </h3>
                {s.blurb && <p className="text-small">{s.blurb}</p>}
                {s.deals.length > 0 && (
                  <p className="text-small text-text-muted">
                    {s.deals.length === 1
                      ? "1 deal for players"
                      : `${s.deals.length} deals for players`}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {sponsors.length === 0 && (
        <p className="text-text-muted">
          Sponsors are on their way. Own a spot near the park?{" "}
          <Link href="/about" className="underline">
            Get in touch
          </Link>
          .
        </p>
      )}
    </>
  );
}
