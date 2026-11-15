import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/json-ld";
import { env } from "@/env";
import { leagueInfo } from "@/lib/seo/league";
import { breadcrumbJsonLd, leagueJsonLd } from "@/lib/seo/structured-data";
import { absoluteUrl, HOME_PARK, siteOrigin } from "@/lib/site";

const PATH = "/nyc-kickball-league";

export const metadata: Metadata = {
  title: "NYC kickball league in Brooklyn",
  description:
    "Coed adult kickball for all of New York City, played in McCarren Park, Brooklyn. Subway routes and rough travel times from every borough.",
  alternates: { canonical: PATH },
};

/**
 * Rough door-to-park times for a weekend afternoon. They are estimates to plan
 * by, not timetables, and the page says so.
 */
const BOROUGHS = [
  {
    name: "Manhattan",
    route:
      "Take the L to Bedford Av, about 10 minutes from 14 St–Union Sq, then walk about 10 minutes north to the park. The NYC Ferry's East River route also stops in North Williamsburg and Greenpoint.",
    time: "About 30 minutes from most of downtown",
  },
  {
    name: "Queens",
    route:
      "Change to the G at Court Sq in Long Island City (from the 7, E or M) and ride three stops to Nassau Av, a block from the park.",
    time: "About 15 minutes from Long Island City",
  },
  {
    name: "Brooklyn",
    route:
      "The G runs up from Carroll Gardens, Fort Greene, Clinton Hill and Bed-Stuy to Nassau Av, and the L comes in from Bushwick to Bedford Av. Plenty of players bike.",
    time: "15 to 30 minutes from most of north and central Brooklyn",
  },
  {
    name: "The Bronx",
    route:
      "Ride the 4, 5 or 6 to 14 St–Union Sq and change to the L for Bedford Av.",
    time: "About an hour from the South Bronx",
  },
  {
    name: "Staten Island",
    route:
      "Take the ferry to Whitehall, the R or W up to 14 St–Union Sq, then the L to Bedford Av.",
    time: "About an hour and a half",
  },
] as const;

const WHY = [
  {
    title: "Every game in one park",
    body: "No hunting for a new field each week. Learn the trip once and you're set for the season.",
  },
  {
    title: "Come solo, leave with a team",
    body: "Free agents are placed on a team before the season starts, so you don't need friends who play.",
  },
  {
    title: "Fun first, score second",
    body: "Coed, friendly and welcoming to people who haven't kicked a ball since school. The standings are real, though.",
  },
] as const;

export default function NycKickballLeaguePage() {
  const origin = siteOrigin(env.BETTER_AUTH_URL);
  const league = leagueInfo(origin);
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-12 px-4 py-12 md:px-6">
      <JsonLd
        data={[
          leagueJsonLd(league),
          breadcrumbJsonLd([
            { name: "Home", url: league.url },
            { name: "NYC kickball league", url: absoluteUrl(origin, PATH) },
          ]),
        ]}
      />
      <header className="flex flex-col gap-4">
        <p>
          <span className="sticker">All five boroughs welcome 🗽</span>
        </p>
        <h1 className="text-h1">
          An NYC kickball league, <span className="swipe">in Brooklyn</span>
        </h1>
        <p className="text-body-lg text-text-muted">
          Looking for adult kickball in New York City? We&apos;re a coed league
          that plays every game in {HOME_PARK.name}, on the{" "}
          {HOME_PARK.neighborhoods} border in north Brooklyn. You don&apos;t
          have to live in Brooklyn: players come from all over the city, and the
          park is a short ride on the G or the L.
        </p>
      </header>

      <section
        aria-labelledby="from-your-borough"
        className="flex flex-col gap-4"
      >
        <h2 id="from-your-borough" className="text-h2">
          Getting here from your borough
        </h2>
        <ul className="flex flex-col gap-4">
          {BOROUGHS.map((borough) => (
            <li
              key={borough.name}
              className="flex flex-col gap-2 rounded-card border-2 border-text bg-surface p-4"
            >
              <h3 className="text-h3">{borough.name}</h3>
              <p>{borough.route}</p>
              <p className="font-bold">{borough.time}</p>
            </li>
          ))}
        </ul>
        <p className="text-text-muted">
          Times are rough door-to-park estimates for a weekend afternoon.
          Weeknight trains and weekend service changes vary, so check a trip
          planner before your first game.
        </p>
        <p>
          <Link
            href={HOME_PARK.path}
            className="font-bold text-brand underline underline-offset-4"
          >
            Find the fields in {HOME_PARK.name}
          </Link>
        </p>
      </section>

      <section aria-labelledby="why" className="flex flex-col gap-4">
        <h2 id="why" className="text-h2">
          Why make the trip
        </h2>
        <ul className="grid gap-4 md:grid-cols-3">
          {WHY.map((reason) => (
            <li
              key={reason.title}
              className="flex flex-col gap-2 rounded-card bg-surface-2 p-4"
            >
              <h3 className="text-h3">{reason.title}</h3>
              <p>{reason.body}</p>
            </li>
          ))}
        </ul>
        <p>
          After the game, teams usually head somewhere nearby for a drink (or a
          seltzer), so a game in the park can easily turn into an afternoon or
          evening in Williamsburg.
        </p>
      </section>

      <section
        aria-labelledby="join"
        className="flex flex-col gap-4 rounded-card border-2 border-text bg-surface p-6"
      >
        <h2 id="join" className="text-h2">
          Play this season
        </h2>
        <p>
          Bring a team, join a friend&apos;s, or come solo. New to kickball? The
          basics take about five minutes to learn.
        </p>
        <div className="flex flex-wrap gap-4">
          <Link href="/sign-in" className="btn btn-primary">
            Sign up for a season
          </Link>
          <Link href="/free-agents" className="btn btn-secondary">
            Join on your own
          </Link>
        </div>
        <p>
          <Link
            href="/news/how-to-play-kickball"
            className="font-bold text-brand underline underline-offset-4"
          >
            How to play kickball
          </Link>
        </p>
      </section>
    </main>
  );
}
