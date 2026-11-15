import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/json-ld";
import { env } from "@/env";
import { leagueInfo } from "@/lib/seo/league";
import { breadcrumbJsonLd } from "@/lib/seo/structured-data";
import { absoluteUrl, siteOrigin } from "@/lib/site";

export const metadata: Metadata = {
  title: "Book a private league or tournament",
  description:
    "Kickball for your company, club or friends: a one-day tournament or a private league in McCarren Park, with fields, refs, a schedule and results run by the league.",
  alternates: { canonical: "/private-events" },
};

const FORMATS = [
  {
    title: "One-day tournament",
    body: "A Saturday or Sunday of games: a round robin, a bracket, or pool play then a bracket. Good for a team outing or a charity day, from 4 to 16 teams.",
  },
  {
    title: "Private league",
    body: "Your own weeknight or weekend league over a few weeks, with standings and a final. Good for a company league or a group of friends, from 4 teams up.",
  },
] as const;

const INCLUDED = [
  "Field time on the league's permits, with bases and balls",
  "A referee for every game",
  "A schedule built by the league's scheduler, fair start times included",
  "Scores, results and standings on a private page for your teams",
  "One invite link for every team captain to bring their players",
] as const;

const STEPS = [
  {
    title: "Ask",
    body: "Tell us who it's for, how many teams and roughly when. You'll get a confirmation email right away.",
  },
  {
    title: "We set it up",
    body: "An admin checks fields and dates, agrees a price with you and sets up your private season.",
  },
  {
    title: "Invite your teams",
    body: "Share the invite link with each captain. Your organization pays once for every team, or players pay their own share, whichever you agree with us.",
  },
  {
    title: "Play",
    body: "Your page shows the teams, the schedule and every result. None of it appears on the league's public pages or in its standings and records.",
  },
] as const;

/** Static: nothing here reads the request, so it is served as HTML. */
export default function PrivateEventsPage() {
  const origin = siteOrigin(env.BETTER_AUTH_URL);
  const league = leagueInfo(origin);
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-12 px-4 py-12 md:px-6">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", url: league.url },
          {
            name: "Private leagues and tournaments",
            url: absoluteUrl(origin, "/private-events"),
          },
        ])}
      />
      <header className="flex flex-col gap-4">
        <p>
          <span className="sticker">For companies, clubs and crews</span>
        </p>
        <h1 className="text-h1">
          Book a private league or <span className="swipe">tournament</span>
        </h1>
        <p className="text-body-lg text-text-muted">
          Bring your office, your club or your group chat to McCarren Park. We
          run the fields, the refs and the schedule; you bring the teams and the
          trash talk.
        </p>
        <Link
          href="/app/private-events/new"
          className="btn self-start btn-primary"
        >
          Request a booking
        </Link>
      </header>

      <section aria-labelledby="formats" className="flex flex-col gap-4">
        <h2 id="formats" className="text-h2">
          Two ways to play
        </h2>
        <ul className="grid gap-4 md:grid-cols-2">
          {FORMATS.map((f) => (
            <li
              key={f.title}
              className="flex flex-col gap-2 rounded-card border-2 border-text bg-surface p-5"
            >
              <h3 className="text-h3">{f.title}</h3>
              <p>{f.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="included" className="flex flex-col gap-4">
        <h2 id="included" className="text-h2">
          What&apos;s included
        </h2>
        <ul className="flex list-disc flex-col gap-2 pl-6">
          {INCLUDED.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="text-text-muted">
          Every player signs the league&apos;s waiver and meets its minimum age,
          as in the league. Field time depends on what NYC Parks has permitted
          to the league, so tell us a few dates that work.
        </p>
      </section>

      <section aria-labelledby="how" className="flex flex-col gap-4">
        <h2 id="how" className="text-h2">
          How it works
        </h2>
        <ol className="flex flex-col gap-4">
          {STEPS.map((step, i) => (
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

      <section
        aria-labelledby="ask"
        className="flex flex-col gap-4 rounded-card border-2 border-text bg-surface p-6"
      >
        <h2 id="ask" className="text-h2">
          Ready to ask?
        </h2>
        <p>
          Sign in with your email and tell us what you have in mind. It takes a
          couple of minutes, and there&apos;s nothing to pay until we agree on
          the details.
        </p>
        <div className="flex flex-wrap gap-4">
          <Link href="/app/private-events/new" className="btn btn-primary">
            Request a booking
          </Link>
          <Link href="/faq" className="btn btn-secondary">
            Read the FAQ
          </Link>
        </div>
      </section>
    </main>
  );
}
