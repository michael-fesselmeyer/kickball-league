import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/json-ld";
import { Kickball } from "@/components/kickball";
import { env } from "@/env";
import { leagueInfo } from "@/lib/seo/league";
import { leagueJsonLd, websiteJsonLd } from "@/lib/seo/structured-data";
import { SITE, siteOrigin } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: `${SITE.name} · Coed adult kickball in Brooklyn` },
  description: SITE.description,
  alternates: { canonical: "/" },
};

const FACTS = [
  {
    term: "What",
    detail: "Coed kickball for adults. Friendly games, real standings.",
  },
  {
    term: "Where",
    detail: "McCarren Park, between Greenpoint and Williamsburg.",
    href: "/parks/mccarren-park",
    label: "Getting there",
  },
  {
    term: "When",
    detail:
      "Sunday afternoons in summer; weeknight evenings in spring and fall.",
  },
  {
    term: "Price",
    detail:
      "Set each season and shown before you pay. Teams can split the fee.",
    href: "/faq#season",
    label: "How fees work",
  },
] as const;

const WAYS_IN = [
  {
    title: "Bring a team",
    body: "Register as captain, share one invite link in the group chat, and everyone signs up and pays their own share.",
  },
  {
    title: "Join a friend's team",
    body: "Open your captain's invite link, sign the waiver, and you're on the roster.",
  },
  {
    title: "Come solo",
    body: "Sign up as a free agent and we'll place you on a team. Half the fun is the new people.",
  },
] as const;

export default function Home() {
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
          <span className="sticker">McCarren Park, Brooklyn ☀️</span>
        </p>
        <h1 id="hero" className="max-w-[14ch] text-display text-text">
          Kick a ball. Meet your new{" "}
          <span className="swipe">favorite people.</span>
        </h1>
        <p className="max-w-prose text-body-lg text-text-muted">
          Grown-up, coed kickball in Brooklyn for people who haven&apos;t played
          since recess. Bring a team or come solo and we&apos;ll find you one.
          Stick around after for a drink (or a seltzer).
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/sign-in" className="btn btn-primary">
            Sign up for a season
          </Link>
          <Link href="/faq" className="btn btn-secondary">
            Questions? We&apos;ve got answers
          </Link>
          <Kickball className="size-12 rotate-12" />
        </div>
      </section>

      <section aria-labelledby="the-basics" className="flex flex-col gap-6">
        <h2 id="the-basics" className="text-h2">
          The basics
        </h2>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FACTS.map((fact) => (
            <div
              key={fact.term}
              className="flex flex-col gap-2 rounded-card border-2 border-text bg-surface p-4"
            >
              <dt className="text-micro font-bold tracking-wider text-text-muted uppercase">
                {fact.term}
              </dt>
              <dd className="flex flex-col gap-2">
                <span>{fact.detail}</span>
                {"href" in fact && (
                  <Link
                    href={fact.href}
                    className="font-bold text-brand underline underline-offset-4"
                  >
                    {fact.label}
                  </Link>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="ways-in" className="flex flex-col gap-6">
        <h2 id="ways-in" className="text-h2">
          Three ways in
        </h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {WAYS_IN.map((way, i) => (
            <li
              key={way.title}
              className="flex flex-col gap-2 rounded-card bg-surface-2 p-4"
            >
              <span
                aria-hidden="true"
                className="font-display text-h2 font-extrabold text-accent"
              >
                {i + 1}
              </span>
              <h3 className="text-h3">{way.title}</h3>
              <p>{way.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section
        aria-labelledby="after"
        className="flex flex-col gap-4 rounded-card border-2 border-text bg-surface p-6 md:p-8"
      >
        <h2 id="after" className="text-h2">
          The game is half of it
        </h2>
        <p className="max-w-prose">
          Teams hang out after games, every season ends in playoffs, and most
          people leave with a few new friends. Nobody has to drink, and nobody
          has to be good at kickball.
        </p>
        <p>
          <Link
            href="/about"
            className="font-bold text-brand underline underline-offset-4"
          >
            More about the league
          </Link>
        </p>
      </section>
    </main>
  );
}
