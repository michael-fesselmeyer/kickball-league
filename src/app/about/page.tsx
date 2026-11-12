import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/json-ld";
import { env } from "@/env";
import { leagueInfo } from "@/lib/seo/league";
import { breadcrumbJsonLd, leagueJsonLd } from "@/lib/seo/structured-data";
import { absoluteUrl, siteOrigin } from "@/lib/site";

export const metadata: Metadata = {
  title: "About the league",
  description:
    "A social, coed adult kickball league in McCarren Park, Brooklyn. How a season works, who it's for, and the few things we ask of everyone.",
  alternates: { canonical: "/about" },
};

const SEASON_STEPS = [
  {
    title: "Sign up",
    body: "Register a team, join one with your captain's invite link, or come solo as a free agent. Everyone signs the season waiver and pays online.",
  },
  {
    title: "Get the schedule",
    body: "The schedule comes out about a week before opening day. Every team gets a fair mix of early and late games.",
  },
  {
    title: "Play every week",
    body: "One ref per game, scores posted after every game, and standings that update themselves.",
  },
  {
    title: "Playoffs",
    body: "The season ends with playoffs and a champion with bragging rights until next season.",
  },
] as const;

const HOUSE_RULES = [
  "Keep it friendly. Cheer for good kicks, both teams' included.",
  "Be good to the refs. Most of them play in the league too.",
  "Nobody has to drink. A seltzer after the game counts just the same.",
  "Leave the field better than you found it. It's a public park and we're guests.",
] as const;

export default function AboutPage() {
  const origin = siteOrigin(env.BETTER_AUTH_URL);
  const league = leagueInfo(origin);
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-12 px-4 py-12 md:px-6">
      <JsonLd
        data={[
          leagueJsonLd(league),
          breadcrumbJsonLd([
            { name: "Home", url: league.url },
            { name: "About", url: absoluteUrl(origin, "/about") },
          ]),
        ]}
      />
      <header className="flex flex-col gap-4">
        <p>
          <span className="sticker">Have fun, meet people</span>
        </p>
        <h1 className="text-h1">
          A kickball league for <span className="swipe">meeting people</span>
        </h1>
        <p className="text-body-lg text-text-muted">
          We&apos;re a coed adult kickball league in McCarren Park, Brooklyn.
          People come for the game, stay for each other, and keep coming back
          season after season. Competitive enough to care about the score,
          relaxed enough that nobody cares if you whiff.
        </p>
      </header>

      <section aria-labelledby="who" className="flex flex-col gap-4">
        <h2 id="who" className="text-h2">
          Who plays
        </h2>
        <p>
          Adults 18 and over from all over the city: new in town, old friends,
          coworkers, roommates, people who just want a reason to be outside on a
          Sunday. Plenty haven&apos;t played kickball since school, and
          that&apos;s fine. You don&apos;t need a team to join; free agents get
          placed on one before the season starts.
        </p>
      </section>

      <section aria-labelledby="season" className="flex flex-col gap-4">
        <h2 id="season" className="text-h2">
          How a season works
        </h2>
        <ol className="flex flex-col gap-4">
          {SEASON_STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-4">
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-text bg-highlight font-display font-extrabold text-on-highlight"
              >
                {i + 1}
              </span>
              <div className="flex flex-col gap-1">
                <h3 className="text-h3">{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="house-rules" className="flex flex-col gap-4">
        <h2 id="house-rules" className="text-h2">
          The house rules
        </h2>
        <p>The rulebook covers the game. These cover everything else:</p>
        <ul className="flex list-disc flex-col gap-2 pl-6">
          {HOUSE_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="questions"
        className="flex flex-col gap-4 rounded-card border-2 border-text bg-surface p-6"
      >
        <h2 id="questions" className="text-h2">
          Questions?
        </h2>
        <p>
          The FAQ covers fees, rain-outs, what to wear and more. Once
          you&apos;re on a team, your captain is the quickest way to reach the
          league.
        </p>
        <div className="flex flex-wrap gap-4">
          <Link href="/faq" className="btn btn-primary">
            Read the FAQ
          </Link>
          <Link href="/parks/mccarren-park" className="btn btn-secondary">
            Find the fields
          </Link>
        </div>
      </section>
    </main>
  );
}
