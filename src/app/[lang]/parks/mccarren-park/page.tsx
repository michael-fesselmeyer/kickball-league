import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/json-ld";
import { env } from "@/env";
import { localeOf, messagesFor } from "@/i18n/messages";
import { languageAlternates, linkIn } from "@/i18n/routing";
import { homeParkInfo } from "@/lib/seo/league";
import { breadcrumbJsonLd, parkJsonLd } from "@/lib/seo/structured-data";
import { absoluteUrl, HOME_PARK, homeParkMapUrl, siteOrigin } from "@/lib/site";

type Props = PageProps<"/[lang]/parks/mccarren-park">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = localeOf((await params).lang);
  const { park } = messagesFor(locale);
  return {
    title: park.title,
    description: park.description,
    alternates: {
      canonical: linkIn(locale, HOME_PARK.path),
      languages: languageAlternates(HOME_PARK.path),
    },
  };
}

const WAYS = ["g", "l", "bike"] as const;
const BRING = ["shoes", "color", "water", "layer"] as const;

export default async function McCarrenParkPage({ params }: Props) {
  const locale = localeOf((await params).lang);
  const { park: words } = messagesFor(locale);
  const href = (path: string) => linkIn(locale, path);
  const origin = siteOrigin(env.BETTER_AUTH_URL);
  const park = homeParkInfo(origin);
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-12 px-4 py-12 md:px-6">
      <JsonLd
        data={[
          parkJsonLd(park),
          breadcrumbJsonLd([
            { name: words.home, url: absoluteUrl(origin, href("/")) },
            {
              name: HOME_PARK.name,
              url: absoluteUrl(origin, href(HOME_PARK.path)),
            },
          ]),
        ]}
      />
      <header className="flex flex-col gap-4">
        <p>
          <span className="sticker">{words.sticker}</span>
        </p>
        <h1 className="text-h1">
          {words.headingStart} <span className="swipe">McCarren Park</span>
        </h1>
        <p className="text-body-lg text-text-muted">{words.intro}</p>
      </header>

      <section aria-labelledby="where" className="flex flex-col gap-4">
        <h2 id="where" className="text-h2">
          {words.whereTitle}
        </h2>
        <address className="not-italic">
          {HOME_PARK.name}
          <br />
          {HOME_PARK.address.streetAddress}, {HOME_PARK.address.addressLocality}
          , {HOME_PARK.address.addressRegion}
        </address>
        <p>
          {words.fields}{" "}
          <Link href={href("/fields/mccarren-park")} className="underline">
            {words.fieldsToday}
          </Link>
          .
        </p>
        <p>
          <a
            href={homeParkMapUrl()}
            className="font-bold text-brand underline underline-offset-4"
          >
            {words.map}
          </a>
        </p>
      </section>

      <section aria-labelledby="getting-there" className="flex flex-col gap-4">
        <h2 id="getting-there" className="text-h2">
          {words.gettingThere}
        </h2>
        <dl className="grid gap-4 sm:grid-cols-3">
          {WAYS.map((key) => (
            <div
              key={key}
              className="flex flex-col gap-1 rounded-card border-2 border-text bg-surface p-4"
            >
              <dt className="font-display text-h3 font-extrabold">
                {words.ways[key].how}
              </dt>
              <dd>{words.ways[key].detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="bring" className="flex flex-col gap-4">
        <h2 id="bring" className="text-h2">
          {words.bringTitle}
        </h2>
        <ul className="flex list-disc flex-col gap-2 pl-6">
          {BRING.map((key) => (
            <li key={key}>{words.bring[key]}</li>
          ))}
        </ul>
        <p>{words.drinks}</p>
      </section>

      <section
        aria-labelledby="play-here"
        className="flex flex-col gap-4 rounded-card border-2 border-text bg-surface p-6"
      >
        <h2 id="play-here" className="text-h2">
          {words.playTitle}
        </h2>
        <p>{words.playBody}</p>
        <div className="flex flex-wrap gap-4">
          <Link href="/sign-in" className="btn btn-primary">
            {words.signUp}
          </Link>
          <Link href={href("/faq")} className="btn btn-secondary">
            {words.readFaq}
          </Link>
          <Link href={href("/contact")} className="btn btn-secondary">
            {words.report}
          </Link>
        </div>
      </section>
    </main>
  );
}
