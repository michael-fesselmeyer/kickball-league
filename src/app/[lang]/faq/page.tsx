import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/json-ld";
import { env } from "@/env";
import { localeOf, messagesFor } from "@/i18n/messages";
import { languageAlternates, linkIn } from "@/i18n/routing";
import { breadcrumbJsonLd, faqJsonLd } from "@/lib/seo/structured-data";
import { absoluteUrl, siteOrigin } from "@/lib/site";
import { faqFor } from "./questions";

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/faq">): Promise<Metadata> {
  const locale = localeOf((await params).lang);
  const { faq } = messagesFor(locale);
  return {
    title: faq.title,
    description: faq.description,
    alternates: {
      canonical: linkIn(locale, "/faq"),
      languages: languageAlternates("/faq"),
    },
  };
}

export default async function FaqPage({ params }: PageProps<"/[lang]/faq">) {
  const locale = localeOf((await params).lang);
  const { faq: words } = messagesFor(locale);
  const groups = faqFor(locale);
  const href = (path: string) => linkIn(locale, path);
  const origin = siteOrigin(env.BETTER_AUTH_URL);
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-4 py-12 md:px-6">
      <JsonLd
        data={[
          faqJsonLd(groups.flatMap((g) => g.questions)),
          breadcrumbJsonLd([
            { name: words.home, url: absoluteUrl(origin, href("/")) },
            { name: words.title, url: absoluteUrl(origin, href("/faq")) },
          ]),
        ]}
      />
      <header className="flex flex-col gap-4">
        <h1 className="text-h1">
          {words.headingStart}{" "}
          <span className="swipe">{words.headingSwipe}</span>
        </h1>
        <p className="text-body-lg text-text-muted">{words.intro}</p>
        <nav aria-label={words.sections}>
          <ul className="flex flex-wrap gap-2">
            {groups.map((group) => (
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

      {groups.map((group) => (
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
              <h3 className="text-h3 break-words">{q.question}</h3>
              <p>{q.answer}</p>
              {q.more && (
                <p>
                  <Link
                    href={href(q.more.href)}
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
          {words.readyTitle}
        </h2>
        <p>{words.readyBody}</p>
        <p>
          <Link href="/sign-in" className="btn btn-primary">
            {words.signUp}
          </Link>
        </p>
      </section>
    </main>
  );
}
