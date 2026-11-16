import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/json-ld";
import { env } from "@/env";
import { breadcrumbJsonLd } from "@/lib/seo/structured-data";
import { absoluteUrl, siteOrigin } from "@/lib/site";
import { localeOf, messagesFor } from "@/i18n/messages";
import { languageAlternates, linkIn } from "@/i18n/routing";
import {
  HELP_ROLES,
  helpEntries,
  helpHref,
  helpRolesFor,
  TRANSLATED_HELP_ROLES,
} from "./articles";
import { HelpSearch } from "./help-search";

type Props = PageProps<"/[lang]/help">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = localeOf((await params).lang);
  const { title, description } = messagesFor(locale).help;
  return {
    title,
    description,
    alternates: {
      canonical: linkIn(locale, "/help"),
      languages: languageAlternates("/help"),
    },
  };
}

/**
 * The help center: every how-to by role, with a search box that filters them
 * as you type. Static content, prerendered at build with no data to read.
 */
export default async function HelpPage({ params }: Props) {
  const locale = localeOf((await params).lang);
  const { help: words } = messagesFor(locale);
  const href = (path: string) => linkIn(locale, path);
  const roles = helpRolesFor(locale);
  const inEnglish = HELP_ROLES.filter(
    (r) => !TRANSLATED_HELP_ROLES[locale].includes(r.slug),
  );
  const origin = siteOrigin(env.BETTER_AUTH_URL);
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-4 py-12 md:px-6">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: words.home, url: absoluteUrl(origin, href("/")) },
          { name: words.title, url: absoluteUrl(origin, href("/help")) },
        ])}
      />
      <header className="flex flex-col gap-4">
        <h1 className="text-h1">
          {words.headingStart}{" "}
          <span className="swipe">{words.headingSwipe}</span>
        </h1>
        <p className="text-body-lg text-text-muted">
          {words.introStart}{" "}
          <Link href={href("/faq")} className="font-bold text-brand underline">
            {words.faq}
          </Link>{" "}
          {words.introMid}{" "}
          <Link
            href={href("/rules")}
            className="font-bold text-brand underline"
          >
            {words.rules}
          </Link>{" "}
          {words.introEnd}
        </p>
      </header>

      <HelpSearch entries={helpEntries(locale)} words={words.search} />

      {roles.map((role) => (
        <section
          key={role.slug}
          aria-labelledby={`role-${role.slug}`}
          className="flex flex-col gap-3"
        >
          <h2 id={`role-${role.slug}`} className="text-h2">
            <Link
              href={href(helpHref(role.slug))}
              className="underline-offset-4 hover:underline"
            >
              {role.title}
            </Link>
          </h2>
          <p className="text-text-muted">{role.intro}</p>
          <ul className="flex flex-col">
            {role.articles.map((a) => (
              <li key={a.id} className="border-t border-border py-2">
                <Link
                  href={href(helpHref(role.slug, a.id))}
                  className="inline-flex min-h-11 items-center font-bold text-brand underline underline-offset-4"
                >
                  {a.title}
                </Link>
                <p className="text-small text-text-muted">{a.summary}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {inEnglish.length > 0 && (
        <section aria-labelledby="in-english" className="flex flex-col gap-3">
          <h2 id="in-english" className="text-h2">
            {words.inEnglishTitle}
          </h2>
          <p className="text-text-muted">{words.inEnglishBody}</p>
          <ul className="flex flex-wrap gap-2">
            {inEnglish.map((r) => (
              <li key={r.slug}>
                <Link
                  href={helpHref(r.slug)}
                  hrefLang="en"
                  lang="en"
                  className="inline-flex min-h-11 items-center rounded-full border border-border bg-surface px-4"
                >
                  {r.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section
        aria-labelledby="widget"
        className="flex flex-col gap-3 rounded-card border-2 border-text bg-surface p-6"
      >
        <h2 id="widget" className="text-h2">
          {words.widgetTitle}
        </h2>
        <p>{words.widgetBody}</p>
        <p>
          <Link href="/widget" className="btn btn-primary">
            {words.widgetLink}
          </Link>
        </p>
      </section>
    </main>
  );
}
