import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/json-ld";
import { env } from "@/env";
import { breadcrumbJsonLd } from "@/lib/seo/structured-data";
import { absoluteUrl, siteOrigin } from "@/lib/site";
import { fill } from "@/i18n/catalog";
import { localeOf, messagesFor } from "@/i18n/messages";
import { languageAlternates, linkIn } from "@/i18n/routing";
import { HELP_ROLES, helpHref, helpRolesFor } from "../articles";

type Props = PageProps<"/[lang]/help/[role]">;

/** Each role's page is prerendered at build; there is no data to read. */
export function generateStaticParams() {
  return HELP_ROLES.map((r) => ({ role: r.slug }));
}

/** A role's how-tos in the page's language, if they are written in it. */
async function load(params: Props["params"]) {
  const { lang, role: slug } = await params;
  const locale = localeOf(lang);
  const roles = helpRolesFor(locale);
  return { locale, roles, role: roles.find((r) => r.slug === slug) };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, role } = await load(params);
  const words = messagesFor(locale).help;
  if (!role) return { title: words.title };
  const path = helpHref(role.slug);
  return {
    title: fill(words.roleTitle, { role: role.title.toLowerCase() }),
    description: fill(words.roleDescription, {
      intro: role.intro,
      list: role.articles.map((a) => a.title.toLowerCase()).join(", "),
    }),
    alternates: {
      canonical: linkIn(locale, path),
      languages: languageAlternates(path),
    },
  };
}

export default async function HelpRolePage({ params }: Props) {
  const { locale, roles, role } = await load(params);
  if (!role) notFound();
  const words = messagesFor(locale).help;
  const href = (path: string) => linkIn(locale, path);
  const origin = siteOrigin(env.BETTER_AUTH_URL);
  const others = roles.filter((r) => r.slug !== role.slug);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-4 py-12 md:px-6">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: words.home, url: absoluteUrl(origin, href("/")) },
          { name: words.title, url: absoluteUrl(origin, href("/help")) },
          {
            name: role.title,
            url: absoluteUrl(origin, href(helpHref(role.slug))),
          },
        ])}
      />
      <header className="flex flex-col gap-4">
        <Link href={href("/help")} className="self-start py-2 underline">
          {words.title}
        </Link>
        <h1 className="text-h1">
          {fill(words.roleTitle, { role: role.title.toLowerCase() })}
        </h1>
        <p className="text-body-lg text-text-muted">{role.intro}</p>
        <nav aria-label={words.onThisPage}>
          <ul className="flex flex-wrap gap-2">
            {role.articles.map((a) => (
              <li key={a.id}>
                <a
                  href={`#${a.id}`}
                  className="inline-flex min-h-11 items-center rounded-full border-2 border-text bg-surface px-4 font-bold"
                >
                  {a.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      {role.articles.map((a) => (
        <section
          key={a.id}
          id={a.id}
          aria-labelledby={`${a.id}-title`}
          className="flex scroll-mt-4 flex-col gap-3"
        >
          <h2 id={`${a.id}-title`} className="text-h2">
            {a.title}
          </h2>
          <p className="text-text-muted">{a.summary}</p>
          <ol className="flex list-decimal flex-col gap-2 pl-6">
            {a.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {a.notes && (
            <ul className="flex list-disc flex-col gap-1 pl-6 text-small text-text-muted">
              {a.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
          {a.screen && (
            <p>
              {words.inApp}{" "}
              <Link
                href={a.screen.href}
                prefetch={false}
                className="inline-flex min-h-11 items-center font-bold text-brand underline underline-offset-4"
              >
                {a.screen.label}
              </Link>
            </p>
          )}
        </section>
      ))}

      <nav aria-labelledby="other-roles" className="flex flex-col gap-3">
        <h2 id="other-roles" className="text-h3">
          {words.others}
        </h2>
        <ul className="flex flex-wrap gap-2">
          {others.map((r) => (
            <li key={r.slug}>
              <Link
                href={href(helpHref(r.slug))}
                className="inline-flex min-h-11 items-center rounded-full border border-border bg-surface px-4"
              >
                {r.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  );
}
