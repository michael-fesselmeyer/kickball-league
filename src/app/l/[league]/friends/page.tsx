import type { Metadata } from "next";
import Link from "next/link";
import { cacheLife, cacheTag } from "next/cache";
import { CopySnippet } from "@/components/copy-snippet";
import { JsonLd } from "@/components/json-ld";
import { db } from "@/db/client";
import { type FriendLeague, friendDirectory } from "@/db/queries/friends";
import { partnerTournaments } from "@/db/queries/tournaments";
import { whenLine } from "@/domain/events/event";
import { clickPingPath } from "@/domain/friends/clicks";
import type { FriendLeagueId, LeagueId } from "@/domain/ids";
import { leagueHref } from "@/domain/league/paths";
import { publicLeague, withCanonical } from "@/lib/league/public";
import {
  ACTIVITY_SPORT,
  displayHost,
  groupDirectory,
} from "@/domain/friends/friend-form";
import { env } from "@/env";
import { readUnlessBuildHasNoDatabase } from "@/lib/build-phase";
import { EVENTS_TAG, FRIENDS_TAG, PUBLIC_PAGE_LIFE } from "@/lib/public-cache";
import { friendsJsonLd } from "@/lib/seo/structured-data";
import { absoluteUrl, SITE, siteOrigin } from "@/lib/site";

/**
 * The page reads its league from the path outside any <Suspense> boundary,
 * so it has no generic fallback shell: a league the build didn't list, or a
 * page an admin's change just expired, is rendered in full before it is
 * served, then kept (as the game page does). Without this, expiring the
 * route makes its next visit fail (ADR 0048).
 */
export const instant = false;

const TITLE = "Friends of the league";

const METADATA: Metadata = {
  title: TITLE,
  description:
    "Clubs our players run, plus softball, soccer, pool, tabletop games and more: other local leagues our players love, and how to link to us from yours.",
};

export function generateMetadata({
  params,
}: PageProps<"/l/[league]/friends">): Promise<Metadata> {
  return withCanonical(params, METADATA, "/friends");
}

/**
 * Static HTML: the directory is read once inside `use cache` and kept until
 * an admin changes an entry (refreshFriendPages) or PUBLIC_PAGE_LIFE runs
 * out. No Suspense boundary, so the list is part of the first paint
 * (ADR 0029).
 */
export default async function FriendsPage({
  params,
}: PageProps<"/l/[league]/friends">) {
  const league = await publicLeague((await params).league, "/friends");
  const [entries, partners] = await Promise.all([
    cachedFriendDirectory(league.id),
    cachedPartnerTournaments(league.id, league.timeZone),
  ]);
  const origin = siteOrigin(env.BETTER_AUTH_URL);
  const home = absoluteUrl(origin, leagueHref(league, "/"));
  const groups = groupDirectory(entries);
  // The JSON-LD lists entries in the same order the page shows them.
  const ordered = groups.flatMap((g) => g.entries);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 py-10 md:px-6">
      {ordered.length > 0 && (
        <JsonLd
          data={friendsJsonLd(
            {
              name: TITLE,
              url: absoluteUrl(origin, leagueHref(league, "/friends")),
            },
            ordered.map((f) => ({
              name: f.name,
              url: f.url,
              sport: ACTIVITY_SPORT[f.activity],
              description: f.description ?? undefined,
              logo: f.logo
                ? absoluteUrl(origin, `/media/friends/${f.logo.id}`)
                : undefined,
              area: f.area ?? undefined,
            })),
          )}
        />
      )}
      <header className="flex flex-col gap-3">
        <h1 className="text-h1">
          Friends of the <span className="swipe">league</span>
        </h1>
        <p className="max-w-prose text-body-lg text-text-muted">
          Lots of our players also play softball, soccer, pool or board games
          around town, and some run clubs of their own. These are the groups
          they love. Give one a try in the off-season, and tell them the
          kickball crowd sent you.
        </p>
      </header>

      {partners.length > 0 && (
        <section
          aria-labelledby="partner-events"
          className="flex flex-col gap-3"
        >
          <h2 id="partner-events" className="text-h2">
            Playing together
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {partners.map((p) => (
              <li
                key={p.slug}
                className="flex flex-col gap-1 rounded-card border-2 border-text bg-surface p-4 shadow-sticker"
              >
                <p className="text-small font-bold text-text-muted">
                  With {entries.find((f) => f.id === p.friendLeagueId)?.name}
                </p>
                <h3 className="font-display text-h3">{p.title}</h3>
                <p className="text-small">{p.when}</p>
                <Link
                  href={leagueHref(league, `/events/${p.slug}`)}
                  className="inline-flex min-h-11 items-center self-start font-bold underline"
                >
                  See the tournament
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {groups.length === 0 ? (
        <p className="rounded-card border border-border bg-surface p-4 text-text-muted">
          The directory is just getting started. Run a local league? Use the
          snippet below to link to us, then let us know.
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          <p className="text-small text-text-muted">
            Each link goes to that group&apos;s own site, which we don&apos;t
            run. We count how many people follow each link, and nothing about
            who they are.
          </p>
          {groups.map((group) => (
            <section
              key={group.key}
              aria-labelledby={`group-${group.key}`}
              className="flex flex-col gap-3"
            >
              <h2 id={`group-${group.key}`} className="text-h2">
                {group.label}
              </h2>
              {group.key === "players" && (
                <p className="max-w-prose text-text-muted">
                  Hobby clubs and meetups run by people who play in the league.
                </p>
              )}
              <ul className="grid gap-4 sm:grid-cols-2">
                {group.entries.map((f) => (
                  <li key={f.id}>
                    <FriendCard friend={f} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <section
        aria-labelledby="link-to-us"
        className="flex flex-col gap-4 rounded-card border border-border bg-surface p-5 shadow-card"
      >
        <h2 id="link-to-us" className="text-h2">
          Link to us
        </h2>
        <p className="max-w-prose">
          Run a league your players might share with ours? Put a link to us on
          your site, and we&apos;ll add yours here. Our address is{" "}
          <a href={home} className="font-bold break-all underline">
            {home}
          </a>
          .
        </p>
        <CopySnippet
          label="Paste this into your site's HTML"
          text={`<a href="${escapeHtml(home)}">${escapeHtml(SITE.name)}</a>`}
        />
      </section>
    </main>
  );
}

const escapeHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function FriendCard({ friend: f }: { friend: FriendLeague }) {
  return (
    <article className="flex h-full gap-4 rounded-card border border-border bg-surface p-4 shadow-card">
      {f.logo && (
        // A small stored copy; the league's name beside it says who it is.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/media/friends/${f.logo.id}`}
          alt=""
          width={f.logo.width}
          height={f.logo.height}
          loading="lazy"
          decoding="async"
          className="size-16 shrink-0 rounded-md object-contain"
        />
      )}
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="font-display text-h3">{f.name}</h3>
        {(f.area || f.linksBack) && (
          <p className="flex flex-wrap items-center gap-2 text-small text-text-muted">
            {f.area && <span>{f.area}</span>}
            {f.linksBack && <span className="sticker">Links to us</span>}
          </p>
        )}
        {f.description && <p className="text-small">{f.description}</p>}
        <a
          href={f.url}
          ping={clickPingPath(f.id)}
          rel="noopener"
          className="inline-block self-start py-3 font-bold break-words underline"
        >
          {displayHost(f.url)}
          <span aria-hidden="true"> ↗</span>
          <span className="sr-only"> (another site)</span>
        </a>
      </div>
    </article>
  );
}

/**
 * The directory, cached under FRIENDS_TAG. A build without a database to
 * read prerenders the empty directory; the first admin change replaces it.
 */
async function cachedFriendDirectory(
  leagueId: LeagueId,
): Promise<FriendLeague[]> {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  cacheTag(FRIENDS_TAG);
  const found = await readUnlessBuildHasNoDatabase(() =>
    friendDirectory(db, leagueId),
  );
  return found ?? [];
}

/**
 * Upcoming tournaments with a partner league, for the cards above the
 * directory. Tagged with the events too, so calling one off or deleting it
 * takes its card down.
 */
async function cachedPartnerTournaments(
  leagueId: LeagueId,
  timeZone: string,
): Promise<
  {
    friendLeagueId: FriendLeagueId;
    slug: string;
    title: string;
    when: string;
  }[]
> {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  cacheTag(FRIENDS_TAG, EVENTS_TAG);
  const found = await readUnlessBuildHasNoDatabase(() =>
    partnerTournaments(db, leagueId, new Date()),
  );
  return (found ?? []).map((p) => ({
    friendLeagueId: p.friendLeagueId,
    slug: p.slug,
    title: p.title,
    when: whenLine(
      { kind: "tournament", startsAt: p.startsAt, endsAt: p.endsAt },
      timeZone,
    ),
  }));
}
