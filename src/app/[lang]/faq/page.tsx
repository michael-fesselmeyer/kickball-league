import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/json-ld";
import { env } from "@/env";
import { breadcrumbJsonLd, faqJsonLd } from "@/lib/seo/structured-data";
import { absoluteUrl, siteOrigin } from "@/lib/site";
import { ALL_QUESTIONS, FAQ } from "./questions";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Do you need a team? Is it coed? What does it cost, what should you wear, and what happens when it rains? Quick answers about adult kickball in Brooklyn.",
  alternates: { canonical: "/faq" },
};

export default function FaqPage() {
  const origin = siteOrigin(env.BETTER_AUTH_URL);
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-4 py-12 md:px-6">
      <JsonLd
        data={[
          faqJsonLd(ALL_QUESTIONS),
          breadcrumbJsonLd([
            { name: "Home", url: absoluteUrl(origin, "/") },
            { name: "FAQ", url: absoluteUrl(origin, "/faq") },
          ]),
        ]}
      />
      <header className="flex flex-col gap-4">
        <h1 className="text-h1">
          Questions, <span className="swipe">answered</span>
        </h1>
        <p className="text-body-lg text-text-muted">
          The short version: it&apos;s coed, you can come solo, and nobody needs
          to be good at kickball.
        </p>
        <nav aria-label="FAQ sections">
          <ul className="flex flex-wrap gap-2">
            {FAQ.map((group) => (
              <li key={group.id}>
                <a
                  href={`#${group.id}`}
                  className="inline-flex min-h-11 items-center rounded-full border-2 border-text bg-surface px-4 font-bold"
                >
                  {group.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      {FAQ.map((group) => (
        <section
          key={group.id}
          id={group.id}
          aria-labelledby={`${group.id}-title`}
          className="flex scroll-mt-4 flex-col gap-6"
        >
          <h2 id={`${group.id}-title`} className="text-h2">
            {group.title}
          </h2>
          {group.questions.map((q) => (
            <div key={q.question} className="flex flex-col gap-2">
              <h3 className="text-h3">{q.question}</h3>
              <p>{q.answer}</p>
              {q.more && (
                <p>
                  <Link
                    href={q.more.href}
                    className="font-bold text-brand underline underline-offset-4"
                  >
                    {q.more.label}
                  </Link>
                </p>
              )}
            </div>
          ))}
        </section>
      ))}

      <section
        aria-labelledby="still"
        className="flex flex-col gap-4 rounded-card border-2 border-text bg-surface p-6"
      >
        <h2 id="still" className="text-h2">
          Ready when you are
        </h2>
        <p>
          Sign in with your email to register a team, join one, or come solo.
        </p>
        <p>
          <Link href="/sign-in" className="btn btn-primary">
            Sign up for a season
          </Link>
        </p>
      </section>
    </main>
  );
}
