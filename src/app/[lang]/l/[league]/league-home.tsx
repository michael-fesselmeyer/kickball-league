import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import { db } from "@/db/client";
import type { LeagueInfo } from "@/db/queries/leagues";
import { publicSeasons } from "@/db/queries/sitemap";
import { sportLabel } from "@/domain/league/new-league";
import { leagueHref } from "@/domain/league/paths";
import { fill } from "@/i18n/catalog";
import type { Locale } from "@/i18n/locales";
import { messagesFor } from "@/i18n/messages";
import { linkIn } from "@/i18n/routing";
import { readUnlessBuildHasNoDatabase } from "@/lib/build-phase";
import { LEAGUES_TAG } from "@/lib/league/public";
import { PUBLIC_PAGE_LIFE } from "@/lib/public-cache";

const PAGES = [
  { path: "/events", key: "events" },
  { path: "/sponsors", key: "sponsors" },
  { path: "/history", key: "history" },
  { path: "/records", key: "records" },
] as const;

/**
 * The home page of a league other than the default (ADR 0048): its name and
 * sport, a way to sign up, and its public seasons. Static, like every
 * public page, and taken from the path's league alone; cached once per
 * language (ADR 0094).
 */
export async function LeagueHome({
  league,
  locale,
}: {
  league: LeagueInfo;
  locale: Locale;
}) {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  cacheTag(LEAGUES_TAG);
  const words = messagesFor(locale).home.league;
  const href = (path: string) => linkIn(locale, leagueHref(league, path));
  const seasons =
    (await readUnlessBuildHasNoDatabase(() => publicSeasons(db, league.id))) ??
    [];
  const signUp = `/app/league/${league.slug}?next=${encodeURIComponent("/app")}`;
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-12 px-4 py-12 md:px-6 md:py-16">
      <section className="flex flex-col gap-6" aria-labelledby="hero">
        <p>
          <span className="sticker">{sportLabel(league.sport)}</span>
        </p>
        <h1
          id="hero"
          className="max-w-[18ch] border-l-8 pl-4 text-display break-words text-text"
          style={{
            borderColor: league.branding.primaryColor ?? "currentColor",
          }}
        >
          {league.name}
        </h1>
        <p className="max-w-prose text-body-lg text-text-muted">
          {fill(words.intro, { league: league.name })}
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <Link href={signUp} className="btn btn-primary" prefetch={false}>
            {messagesFor(locale).home.signUp}
          </Link>
        </div>
      </section>

      <section aria-labelledby="seasons" className="flex flex-col gap-4">
        <h2 id="seasons" className="text-h2">
          {words.seasons}
        </h2>
        {seasons.length === 0 ? (
          <p className="text-text-muted">{words.noSeasons}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {seasons.map((s) => (
              <li
                key={s.slug}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-card border border-border bg-surface p-4"
              >
                <span className="font-bold">{s.name}</span>
                <Link
                  href={href(`/seasons/${s.slug}/schedule`)}
                  className="inline-flex min-h-11 items-center text-brand underline"
                >
                  {words.schedule}
                </Link>
                <Link
                  href={href(`/seasons/${s.slug}/standings`)}
                  className="inline-flex min-h-11 items-center text-brand underline"
                >
                  {words.standings}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <nav aria-label={fill(words.more, { league: league.name })}>
        <ul className="flex flex-wrap gap-x-6 gap-y-2">
          {PAGES.map((p) => (
            <li key={p.path}>
              <Link
                href={href(p.path)}
                className="inline-flex min-h-11 items-center font-bold text-brand underline underline-offset-4"
              >
                {words[p.key]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  );
}
