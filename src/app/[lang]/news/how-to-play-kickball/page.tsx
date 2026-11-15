import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/json-ld";
import { env } from "@/env";
import { leagueInfo } from "@/lib/seo/league";
import { articleJsonLd, breadcrumbJsonLd } from "@/lib/seo/structured-data";
import { absoluteUrl, siteOrigin } from "@/lib/site";

const PATH = "/news/how-to-play-kickball";
const HEADLINE = "How to play kickball";
const DESCRIPTION =
  "How to play kickball, in plain words: the field, positions, pitching and kicking, getting outs, running the bases, and tips for your first game.";
/** Bump `UPDATED` when the guide's content changes. */
const PUBLISHED = new Date("2026-11-12T12:00:00Z");
const UPDATED: Date | undefined = undefined;

export const metadata: Metadata = {
  title: "How to play kickball: the basics",
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  openGraph: {
    type: "article",
    title: "How to play kickball: the basics",
    description: DESCRIPTION,
    publishedTime: PUBLISHED.toISOString(),
  },
};

/*
 * General kickball basics, written for this guide. It deliberately does not
 * quote or paraphrase the league's own rulebook, which stays out of the
 * repository until the league publishes it.
 */

const CONTENTS = [
  { id: "the-idea", label: "The idea" },
  { id: "field-and-ball", label: "The field and the ball" },
  { id: "positions", label: "Teams and positions" },
  { id: "pitching-and-kicking", label: "Pitching and kicking" },
  { id: "outs", label: "Getting outs" },
  { id: "running", label: "Running the bases" },
  { id: "scoring", label: "Scoring and innings" },
  { id: "coed", label: "Adult and coed leagues" },
  { id: "tips", label: "Tips for your first game" },
] as const;

const POSITIONS = [
  {
    name: "Pitcher",
    job: "Rolls the ball to the kicker and covers kicks back up the middle.",
  },
  {
    name: "Catcher",
    job: "Stands behind home plate, fields short kicks and guards home.",
  },
  {
    name: "First, second and third base",
    job: "Stand near their bases to catch throws and make force outs.",
  },
  {
    name: "Shortstop",
    job: "Covers the gap between second and third, where a lot of kicks go.",
  },
  {
    name: "Outfielders",
    job: "Play deep to catch the big kicks. Many adult teams use four of them.",
  },
] as const;

const OUTS = [
  "A fielder catches the kicked ball before it touches the ground.",
  "A fielder holding the ball touches a base before a runner who is forced to run there arrives (a force out).",
  "A fielder tags a runner with the ball while the runner is off a base.",
  "A fielder throws the ball and hits a runner who is off a base. Most leagues only count hits below the shoulders, and a hit to the head usually means the runner is safe.",
  "The kicker runs out of strikes or fouls.",
] as const;

const TIPS = [
  "Kick it low. Ground balls and line drives are far harder to catch than high, lazy fly balls.",
  "Aim for the gaps between fielders, not at them. Placement beats power.",
  "Run on every kick. Make the fielders make the play.",
  "In the field, throw to a base before you throw at a runner. A missed throw at a runner rolls away, and everyone advances.",
  "Call for the ball loudly. Two fielders going for the same catch is how fly balls drop.",
  "Wear sneakers or turf shoes, and stretch before the game. Kicking muscles you haven't used since school will remind you.",
] as const;

export default function HowToPlayKickballPage() {
  const origin = siteOrigin(env.BETTER_AUTH_URL);
  const league = leagueInfo(origin);
  const url = absoluteUrl(origin, PATH);
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-12 px-4 py-12 md:px-6">
      <JsonLd
        data={[
          articleJsonLd(
            {
              headline: HEADLINE,
              description: DESCRIPTION,
              url,
              datePublished: PUBLISHED,
              dateModified: UPDATED,
            },
            league,
          ),
          breadcrumbJsonLd([
            { name: "Home", url: league.url },
            { name: HEADLINE, url },
          ]),
        ]}
      />
      <article className="flex flex-col gap-12">
        <header className="flex flex-col gap-4">
          <p>
            <span className="sticker">The guide 📋</span>
          </p>
          <h1 className="text-h1">
            How to play <span className="swipe">kickball</span>
          </h1>
          <p className="text-body-lg text-text-muted">
            Kickball is baseball with a big rubber ball and no bat. The pitcher
            rolls the ball, the kicker kicks it, and runners go around four
            bases to score. If you played at recess, you already know most of
            it. Here are the basics, in plain words.
          </p>
          <p className="text-micro text-text-muted">
            Published{" "}
            <time dateTime={PUBLISHED.toISOString()}>
              {new Intl.DateTimeFormat("en-US", {
                dateStyle: "long",
                timeZone: "America/New_York",
              }).format(PUBLISHED)}
            </time>
          </p>
        </header>

        <nav
          aria-labelledby="contents"
          className="flex flex-col gap-2 rounded-card bg-surface-2 p-4"
        >
          <h2 id="contents" className="text-h3">
            In this guide
          </h2>
          <ol className="flex list-decimal flex-col gap-1 pl-6">
            {CONTENTS.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className="inline-flex min-h-11 items-center text-brand underline underline-offset-4"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <section aria-labelledby="the-idea" className="flex flex-col gap-4">
          <h2 id="the-idea" className="text-h2">
            The idea
          </h2>
          <p>
            Two teams take turns. One team kicks while the other fields. The
            kicking team tries to get its players around the bases and home; the
            fielding team tries to get three outs so it can kick next. Each time
            a runner crosses home plate, that&apos;s a run. Most runs at the end
            wins.
          </p>
        </section>

        <section
          aria-labelledby="field-and-ball"
          className="flex flex-col gap-4"
        >
          <h2 id="field-and-ball" className="text-h2">
            The field and the ball
          </h2>
          <p>
            Kickball is played on a diamond like a baseball or softball field:
            home plate, first, second and third base, with the pitcher in the
            middle. Anything kicked outside the lines from home through first
            and third is foul.
          </p>
          <p>
            The ball is a soft, red rubber playground ball, about the size of a
            soccer ball but lighter and bouncier. It stings a little if it hits
            you, and that&apos;s about it.
          </p>
        </section>

        <section aria-labelledby="positions" className="flex flex-col gap-4">
          <h2 id="positions" className="text-h2">
            Teams and positions
          </h2>
          <p>
            Adult teams usually put somewhere between eight and eleven players
            in the field, depending on the league. The positions borrow from
            baseball:
          </p>
          <dl className="flex flex-col gap-3">
            {POSITIONS.map((position) => (
              <div
                key={position.name}
                className="flex flex-col gap-1 rounded-card border-2 border-text bg-surface p-4"
              >
                <dt className="font-bold">{position.name}</dt>
                <dd>{position.job}</dd>
              </div>
            ))}
          </dl>
          <p>
            Everyone on the team kicks, in a set order that stays the same all
            game, even if they don&apos;t play in the field every inning.
          </p>
        </section>

        <section
          aria-labelledby="pitching-and-kicking"
          className="flex flex-col gap-4"
        >
          <h2 id="pitching-and-kicking" className="text-h2">
            Pitching and kicking
          </h2>
          <p>
            The pitcher rolls the ball along the ground toward home plate. A
            roll that crosses the plate at a fair speed and without big bounces
            is a strike if the kicker doesn&apos;t kick it; one that misses the
            plate is a ball.
          </p>
          <p>
            The kicker kicks the rolling ball with a foot or leg, then runs for
            first base. A kicker who runs out of strikes is out, and a kicker
            who draws enough balls walks to first. A kick that lands foul counts
            against the kicker too, and too many fouls is an out. The exact
            counts differ from league to league.
          </p>
        </section>

        <section aria-labelledby="outs" className="flex flex-col gap-4">
          <h2 id="outs" className="text-h2">
            Getting outs
          </h2>
          <p>
            The fielding team needs three outs to end an inning. A player is out
            when:
          </p>
          <ul className="flex list-disc flex-col gap-2 pl-6">
            {OUTS.map((out) => (
              <li key={out}>{out}</li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="running" className="flex flex-col gap-4">
          <h2 id="running" className="text-h2">
            Running the bases
          </h2>
          <p>
            Runners stay on their base until the ball is kicked: no leading off
            and no stealing. Once it&apos;s kicked, run! A runner can stop
            safely on any base, and two runners can never share one, which is
            why the runner behind you can force you to move up.
          </p>
          <p>
            If a fielder catches a kick in the air, runners have to go back and
            touch the base they started from before they can try to advance.
            That&apos;s called tagging up.
          </p>
        </section>

        <section aria-labelledby="scoring" className="flex flex-col gap-4">
          <h2 id="scoring" className="text-h2">
            Scoring and innings
          </h2>
          <p>
            An inning is one turn kicking for each team. A full game is usually
            somewhere between five and nine innings, and many adult leagues also
            set a time limit so games end on schedule. If the score is tied at
            the end, leagues settle it in different ways, from extra innings to
            simply calling it a tie.
          </p>
        </section>

        <section aria-labelledby="coed" className="flex flex-col gap-4">
          <h2 id="coed" className="text-h2">
            Adult and coed leagues
          </h2>
          <p>
            Adult leagues build on the playground game with a few extra rules.
            Coed leagues often ask for a minimum number of men and women in the
            field and a mixed kicking order. Many limit bunting, set a strike
            zone for pitches, and add rules that keep the game safe and moving.
          </p>
          <p>
            Every league writes its own version, so read your league&apos;s
            rulebook before opening day. Your ref and your captain will help
            with the rest on the field.
          </p>
        </section>

        <section aria-labelledby="tips" className="flex flex-col gap-4">
          <h2 id="tips" className="text-h2">
            Tips for your first game
          </h2>
          <ul className="flex list-disc flex-col gap-2 pl-6">
            {TIPS.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </section>
      </article>

      <section
        aria-labelledby="play"
        className="flex flex-col gap-4 rounded-card border-2 border-text bg-surface p-6"
      >
        <h2 id="play" className="text-h2">
          Ready to try it?
        </h2>
        <p>
          The league plays coed kickball in McCarren Park, Brooklyn. Bring a
          team, or come solo and we&apos;ll find you one.
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
            href="/faq"
            className="font-bold text-brand underline underline-offset-4"
          >
            Read the FAQ
          </Link>
        </p>
      </section>
    </main>
  );
}
