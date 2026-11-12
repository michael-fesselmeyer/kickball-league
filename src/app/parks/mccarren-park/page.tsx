import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/json-ld";
import { env } from "@/env";
import { homeParkInfo } from "@/lib/seo/league";
import { breadcrumbJsonLd, parkJsonLd } from "@/lib/seo/structured-data";
import { absoluteUrl, HOME_PARK, homeParkMapUrl, siteOrigin } from "@/lib/site";

export const metadata: Metadata = {
  title: "Kickball in McCarren Park, Brooklyn",
  description:
    "Where the league plays in McCarren Park, on the Greenpoint and Williamsburg border: subway lines, bikes, what to bring, and finding your field.",
  alternates: { canonical: HOME_PARK.path },
};

const GETTING_THERE = [
  {
    how: "G train",
    detail: "Nassau Av station, a block from the park's east side.",
  },
  {
    how: "L train",
    detail: "Bedford Av station, about a ten-minute walk south of the park.",
  },
  {
    how: "Bike",
    detail:
      "Citi Bike docks sit around the edge of the park. Lock up off the field.",
  },
] as const;

const BRING = [
  "Sneakers or turf shoes",
  "Something in your team's color",
  "Water, and sunscreen in summer",
  "A layer for evening games",
] as const;

export default function McCarrenParkPage() {
  const origin = siteOrigin(env.BETTER_AUTH_URL);
  const park = homeParkInfo(origin);
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-12 px-4 py-12 md:px-6">
      <JsonLd
        data={[
          parkJsonLd(park),
          breadcrumbJsonLd([
            { name: "Home", url: absoluteUrl(origin, "/") },
            { name: HOME_PARK.name, url: park.url },
          ]),
        ]}
      />
      <header className="flex flex-col gap-4">
        <p>
          <span className="sticker">Our home field 🏟️</span>
        </p>
        <h1 className="text-h1">
          Kickball in <span className="swipe">McCarren Park</span>
        </h1>
        <p className="text-body-lg text-text-muted">
          Every league game is played in McCarren Park, the big green square
          where Greenpoint meets Williamsburg in north Brooklyn. Here&apos;s how
          to get there and what to bring.
        </p>
      </header>

      <section aria-labelledby="where" className="flex flex-col gap-4">
        <h2 id="where" className="text-h2">
          Where we play
        </h2>
        <address className="not-italic">
          {HOME_PARK.name}
          <br />
          {HOME_PARK.address.streetAddress}, {HOME_PARK.address.addressLocality}
          , {HOME_PARK.address.addressRegion}
        </address>
        <p>
          The park has several ball fields. Your game page names yours, so check
          it before you head out.
        </p>
        <p>
          <a
            href={homeParkMapUrl()}
            className="font-bold text-brand underline underline-offset-4"
          >
            Open McCarren Park on a map
          </a>
        </p>
      </section>

      <section aria-labelledby="getting-there" className="flex flex-col gap-4">
        <h2 id="getting-there" className="text-h2">
          Getting there
        </h2>
        <dl className="grid gap-4 sm:grid-cols-3">
          {GETTING_THERE.map((way) => (
            <div
              key={way.how}
              className="flex flex-col gap-1 rounded-card border-2 border-text bg-surface p-4"
            >
              <dt className="font-display text-h3 font-extrabold">{way.how}</dt>
              <dd>{way.detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="bring" className="flex flex-col gap-4">
        <h2 id="bring" className="text-h2">
          What to bring
        </h2>
        <ul className="flex list-disc flex-col gap-2 pl-6">
          {BRING.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p>
          Drinks wait until after the game: alcohol isn&apos;t allowed in city
          parks. Teams usually head somewhere nearby afterward for a drink (or a
          seltzer).
        </p>
      </section>

      <section
        aria-labelledby="play-here"
        className="flex flex-col gap-4 rounded-card border-2 border-text bg-surface p-6"
      >
        <h2 id="play-here" className="text-h2">
          Play here this season
        </h2>
        <p>
          Bring a team or come solo. Days and times are on each season&apos;s
          page before registration opens.
        </p>
        <div className="flex flex-wrap gap-4">
          <Link href="/sign-in" className="btn btn-primary">
            Sign up for a season
          </Link>
          <Link href="/faq" className="btn btn-secondary">
            Read the FAQ
          </Link>
        </div>
      </section>
    </main>
  );
}
