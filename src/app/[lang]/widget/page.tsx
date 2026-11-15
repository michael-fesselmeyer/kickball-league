import type { Metadata } from "next";
import Link from "next/link";
import { CopySnippet } from "@/components/copy-snippet";
import { WIDGET_HEIGHT, widgetSnippet } from "@/domain/widget/schedule-widget";
import { env } from "@/env";
import { absoluteUrl, SITE, siteOrigin } from "@/lib/site";
import { widgetDirectory } from "@/lib/widget/data";

export const metadata: Metadata = {
  title: "Schedule widget",
  description:
    "Show the league's next games, or one team's, on your own site: paste one line of HTML. It updates itself and runs no scripts.",
  alternates: { canonical: "/widget" },
};

/**
 * "Get the widget": the snippet for the league's schedule and one for each
 * team in the season the widget follows. Static HTML, read inside `use
 * cache` (src/lib/widget/data.ts), with no Suspense boundary, so the page
 * is in the first paint (ADR 0029).
 */
export default async function WidgetPage() {
  const origin = siteOrigin(env.BETTER_AUTH_URL);
  const directory = await widgetDirectory();
  const leagueSrc = absoluteUrl(origin, "/embed/schedule");
  const teams = directory?.teams ?? [];

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-4 py-12 md:px-6">
      <header className="flex flex-col gap-4">
        <h1 className="text-h1">
          Our schedule, <span className="swipe">on your site</span>
        </h1>
        <p className="max-w-prose text-body-lg text-text-muted">
          Sponsor bars and teams can show the next games on their own site.
          Paste one line into your page&apos;s HTML. It updates itself when the
          schedule changes, follows your visitors&apos; light or dark setting,
          and runs no scripts.
        </p>
      </header>

      <section aria-labelledby="league" className="flex flex-col gap-4">
        <h2 id="league" className="text-h2">
          The league&apos;s next game day
        </h2>
        <p>Every game on the next game day, with times and fields.</p>
        <CopySnippet
          label="Paste this into your site's HTML"
          text={widgetSnippet({
            src: leagueSrc,
            title: `${SITE.name}: next games`,
            height: WIDGET_HEIGHT.league,
          })}
        />
        <div className="flex flex-col gap-2">
          <h3 className="text-h3">How it looks</h3>
          {/* The same frame the snippet makes, at its height, so nothing shifts. */}
          <iframe
            src="/embed/schedule"
            title={`${SITE.name}: next games (preview)`}
            width="100%"
            height={WIDGET_HEIGHT.league}
            loading="lazy"
            className="max-w-[420px] rounded-card border border-border"
          />
        </div>
      </section>

      <section aria-labelledby="teams" className="flex flex-col gap-4">
        <h2 id="teams" className="text-h2">
          One team&apos;s next games
        </h2>
        <p>
          A team&apos;s next three games, each with the opponent, time and
          field.
        </p>
        {teams.length === 0 ? (
          <p className="rounded-card border border-border bg-surface p-4 text-text-muted">
            Teams show up here once the season has them.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {teams.map((team) => (
              <li key={team.slug}>
                <details className="rounded-card border border-border bg-surface px-4">
                  <summary className="flex min-h-11 cursor-pointer items-center font-bold">
                    {team.name}
                  </summary>
                  <div className="flex flex-col gap-3 pb-4">
                    <CopySnippet
                      label={`Snippet for ${team.name}`}
                      text={widgetSnippet({
                        src: absoluteUrl(
                          origin,
                          `/embed/schedule/${team.slug}`,
                        ),
                        title: `${team.name}: next games`,
                        height: WIDGET_HEIGHT.team,
                      })}
                    />
                    <a
                      href={`/embed/schedule/${team.slug}`}
                      className="self-start py-2 underline"
                    >
                      Preview the widget
                      <span className="sr-only"> for {team.name}</span>
                    </a>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="tips"
        className="flex flex-col gap-3 rounded-card border-2 border-text bg-surface p-6"
      >
        <h2 id="tips" className="text-h2">
          Good to know
        </h2>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>
            Games are listed in the league&apos;s time zone. A rained-out game
            drops off the list as soon as the league calls it.
          </li>
          <li>
            If a long field name gets cut off, raise the{" "}
            <code className="font-mono">height</code> in the snippet.
          </li>
          <li>
            Links in the widget open our site in a new tab, never inside your
            page.
          </li>
        </ul>
        <p>
          Questions? See the{" "}
          <Link href="/help" className="font-bold underline">
            help center
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
