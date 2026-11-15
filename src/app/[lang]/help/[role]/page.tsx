import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/json-ld";
import { env } from "@/env";
import { breadcrumbJsonLd } from "@/lib/seo/structured-data";
import { absoluteUrl, siteOrigin } from "@/lib/site";
import { HELP_ROLES, helpHref, roleBySlug } from "../articles";

type Props = PageProps<"/[lang]/help/[role]">;

/** Each role's page is prerendered at build; there is no data to read. */
export function generateStaticParams() {
  return HELP_ROLES.map((r) => ({ role: r.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const role = roleBySlug((await params).role);
  if (!role) return { title: "Help center" };
  return {
    title: `Help for ${role.title.toLowerCase()}`,
    description: `${role.intro} Short how-tos: ${role.articles
      .map((a) => a.title.toLowerCase())
      .join(", ")}.`,
    alternates: { canonical: helpHref(role.slug) },
  };
}

export default async function HelpRolePage({ params }: Props) {
  const role = roleBySlug((await params).role);
  if (!role) notFound();
  const origin = siteOrigin(env.BETTER_AUTH_URL);
  const others = HELP_ROLES.filter((r) => r.slug !== role.slug);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-4 py-12 md:px-6">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", url: absoluteUrl(origin, "/") },
          { name: "Help center", url: absoluteUrl(origin, "/help") },
          {
            name: role.title,
            url: absoluteUrl(origin, helpHref(role.slug)),
          },
        ])}
      />
      <header className="flex flex-col gap-4">
        <Link href="/help" className="self-start py-2 underline">
          Help center
        </Link>
        <h1 className="text-h1">Help for {role.title.toLowerCase()}</h1>
        <p className="text-body-lg text-text-muted">{role.intro}</p>
        <nav aria-label="On this page">
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
              In the app:{" "}
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
          Help for others
        </h2>
        <ul className="flex flex-wrap gap-2">
          {others.map((r) => (
            <li key={r.slug}>
              <Link
                href={helpHref(r.slug)}
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
