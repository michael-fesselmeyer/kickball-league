import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/json-ld";
import { env } from "@/env";
import { localeOf, messagesFor } from "@/i18n/messages";
import { languageAlternates, linkIn } from "@/i18n/routing";
import { leagueInfo } from "@/lib/seo/league";
import { breadcrumbJsonLd, leagueJsonLd } from "@/lib/seo/structured-data";
import { absoluteUrl, siteOrigin } from "@/lib/site";

type Props = PageProps<"/[lang]/about">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = localeOf((await params).lang);
  const { about } = messagesFor(locale);
  return {
    title: about.title,
    description: about.description,
    alternates: {
      canonical: linkIn(locale, "/about"),
      languages: languageAlternates("/about"),
    },
  };
}

const STEPS = ["signUp", "schedule", "play", "playoffs"] as const;
const HOUSE_RULES = ["friendly", "refs", "drink", "field"] as const;

export default async function AboutPage({ params }: Props) {
  const locale = localeOf((await params).lang);
  const { about: words } = messagesFor(locale);
  const href = (path: string) => linkIn(locale, path);
  const origin = siteOrigin(env.BETTER_AUTH_URL);
  const league = leagueInfo(origin);
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-12 px-4 py-12 md:px-6">
      <JsonLd
        data={[
          leagueJsonLd(league),
          breadcrumbJsonLd([
            { name: words.home, url: absoluteUrl(origin, href("/")) },
            { name: words.crumb, url: absoluteUrl(origin, href("/about")) },
          ]),
        ]}
      />
      <header className="flex flex-col gap-4">
        <p>
          <span className="sticker">{words.sticker}</span>
        </p>
        <h1 className="text-h1">
          {words.headingStart}{" "}
          <span className="swipe">{words.headingSwipe}</span>
        </h1>
        <p className="text-body-lg text-text-muted">{words.intro}</p>
      </header>

      <section aria-labelledby="who" className="flex flex-col gap-4">
        <h2 id="who" className="text-h2">
          {words.whoTitle}
        </h2>
        <p>{words.whoBody}</p>
      </section>

      <section aria-labelledby="season" className="flex flex-col gap-4">
        <h2 id="season" className="text-h2">
          {words.seasonTitle}
        </h2>
        <ol className="flex flex-col gap-4">
          {STEPS.map((key, i) => (
            <li key={key} className="flex gap-4">
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-text bg-highlight font-display font-extrabold text-on-highlight"
              >
                {i + 1}
              </span>
              <div className="flex flex-col gap-1">
                <h3 className="text-h3">{words.steps[key].title}</h3>
                <p>{words.steps[key].body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="house-rules" className="flex flex-col gap-4">
        <h2 id="house-rules" className="text-h2">
          {words.houseRulesTitle}
        </h2>
        <p>{words.houseRulesIntro}</p>
        <ul className="flex list-disc flex-col gap-2 pl-6">
          {HOUSE_RULES.map((key) => (
            <li key={key}>{words.houseRules[key]}</li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="questions"
        className="flex flex-col gap-4 rounded-card border-2 border-text bg-surface p-6"
      >
        <h2 id="questions" className="text-h2">
          {words.questionsTitle}
        </h2>
        <p>{words.questionsBody}</p>
        <div className="flex flex-wrap gap-4">
          <Link href={href("/faq")} className="btn btn-primary">
            {words.readFaq}
          </Link>
          <Link
            href={href("/parks/mccarren-park")}
            className="btn btn-secondary"
          >
            {words.findFields}
          </Link>
          <Link href={href("/contact")} className="btn btn-secondary">
            {words.contact}
          </Link>
        </div>
      </section>
    </main>
  );
}
