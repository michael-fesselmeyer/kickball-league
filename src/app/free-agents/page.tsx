import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/json-ld";
import { env } from "@/env";
import {
  breadcrumbJsonLd,
  faqJsonLd,
  type Question,
} from "@/lib/seo/structured-data";
import { absoluteUrl, HOME_PARK, siteOrigin } from "@/lib/site";

const PATH = "/free-agents";

export const metadata: Metadata = {
  title: "Join a kickball team as a free agent",
  description:
    "No team? Sign up for adult kickball in Brooklyn on your own. How free-agent signup works, what it costs, and how you get placed on a team.",
  alternates: { canonical: PATH },
};

const STEPS = [
  {
    title: "Sign in and pick a season",
    body: "Sign in with your email, open the season you want to play, and choose to join on your own.",
  },
  {
    title: "Sign the waiver and pay your fee",
    body: "Every player signs the season's waiver. You pay your own free-agent fee online, and you see the price before you pay anything.",
  },
  {
    title: "Get placed on a team",
    body: "Before the season starts, the league places you on a team that needs players. Your team shows up in your account.",
  },
  {
    title: "Meet your team on the field",
    body: `Your game page has the time and the field in ${HOME_PARK.name}. Show up a few minutes early and say hi.`,
  },
] as const;

/** Shown on the page and sent as FAQPage structured data, word for word. */
const QUESTIONS: readonly Question[] = [
  {
    question: "Is it awkward to join a kickball team alone?",
    answer:
      "Less than you'd think. Lots of players start solo, teams are used to welcoming new people, and everyone is there to play and meet people. By the second game you'll know everyone's name.",
  },
  {
    question: "How much does it cost to play as a free agent?",
    answer:
      "The free-agent fee is set each season and shown on the season's sign-up page before you pay. You pay only your own share, online.",
  },
  {
    question: "Do I need to be good at kickball?",
    answer:
      "No. If you remember recess, you're qualified. Games are friendly, and the refs explain calls as they go.",
  },
  {
    question: "Can I join a friend's team instead?",
    answer:
      "Yes. Ask your friend's captain for the team's invite link and join through it. Have a few friends who want to play? One of you can register a team as captain and send the others the link.",
  },
];

export default function FreeAgentsPage() {
  const origin = siteOrigin(env.BETTER_AUTH_URL);
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-12 px-4 py-12 md:px-6">
      <JsonLd
        data={[
          faqJsonLd(QUESTIONS),
          breadcrumbJsonLd([
            { name: "Home", url: absoluteUrl(origin, "/") },
            { name: "Free agents", url: absoluteUrl(origin, PATH) },
          ]),
        ]}
      />
      <header className="flex flex-col gap-4">
        <p>
          <span className="sticker">No team? No problem 🙌</span>
        </p>
        <h1 className="text-h1">
          Join a kickball team <span className="swipe">on your own</span>
        </h1>
        <p className="text-body-lg text-text-muted">
          You don&apos;t need a team to play. Sign up as a free agent and the
          league puts you on one before the season starts. It&apos;s how plenty
          of players begin, and the quickest way to meet people in Brooklyn.
        </p>
      </header>

      <section aria-labelledby="how-it-works" className="flex flex-col gap-4">
        <h2 id="how-it-works" className="text-h2">
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

      <section aria-labelledby="questions" className="flex flex-col gap-4">
        <h2 id="questions" className="text-h2">
          Good to know
        </h2>
        <dl className="flex flex-col gap-6">
          {QUESTIONS.map((q) => (
            <div key={q.question} className="flex flex-col gap-1">
              <dt className="font-display text-h3 font-extrabold">
                {q.question}
              </dt>
              <dd>{q.answer}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section
        aria-labelledby="sign-up"
        className="flex flex-col gap-4 rounded-card border-2 border-text bg-surface p-6"
      >
        <h2 id="sign-up" className="text-h2">
          Ready to play?
        </h2>
        <p>
          Sign in to see the open seasons and join as a free agent. Rusty on the
          rules? Read the basics first.
        </p>
        <div className="flex flex-wrap gap-4">
          <Link href="/sign-in" className="btn btn-primary">
            Sign up as a free agent
          </Link>
          <Link href="/news/how-to-play-kickball" className="btn btn-secondary">
            How to play kickball
          </Link>
        </div>
      </section>
    </main>
  );
}
