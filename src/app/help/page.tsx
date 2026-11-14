import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/json-ld";
import { env } from "@/env";
import { breadcrumbJsonLd } from "@/lib/seo/structured-data";
import { absoluteUrl, siteOrigin } from "@/lib/site";
import { HELP_ROLES, helpEntries, helpHref } from "./articles";
import { HelpSearch } from "./help-search";

export const metadata: Metadata = {
  title: "Help center",
  description:
    "Short how-tos for players, captains, refs, admins and owners: signing up, paying, RSVPs, subs, kicking orders, scores, rain-outs and more.",
  alternates: { canonical: "/help" },
};

/**
 * The help center: every how-to by role, with a search box that filters them
 * as you type. Static content, prerendered at build with no data to read.
 */
export default function HelpPage() {
  const origin = siteOrigin(env.BETTER_AUTH_URL);
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-4 py-12 md:px-6">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", url: absoluteUrl(origin, "/") },
          { name: "Help center", url: absoluteUrl(origin, "/help") },
        ])}
      />
      <header className="flex flex-col gap-4">
        <h1 className="text-h1">
          How do I <span className="swipe">…?</span>
        </h1>
        <p className="text-body-lg text-text-muted">
          Short how-tos for everything the app does, by who you are at the
          league. New here? The{" "}
          <Link href="/faq" className="font-bold text-brand underline">
            FAQ
          </Link>{" "}
          covers the basics.
        </p>
      </header>

      <HelpSearch entries={helpEntries()} />

      {HELP_ROLES.map((role) => (
        <section
          key={role.slug}
          aria-labelledby={`role-${role.slug}`}
          className="flex flex-col gap-3"
        >
          <h2 id={`role-${role.slug}`} className="text-h2">
            <Link
              href={helpHref(role.slug)}
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
                  href={helpHref(role.slug, a.id)}
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

      <section
        aria-labelledby="widget"
        className="flex flex-col gap-3 rounded-card border-2 border-text bg-surface p-6"
      >
        <h2 id="widget" className="text-h2">
          Run a bar or a team site?
        </h2>
        <p>Show the next games on your own site with one line of HTML.</p>
        <p>
          <Link href="/widget" className="btn btn-primary">
            Get the schedule widget
          </Link>
        </p>
      </section>
    </main>
  );
}
