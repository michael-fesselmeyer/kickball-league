import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import { CopySnippet } from "@/components/copy-snippet";
import { JsonLd } from "@/components/json-ld";
import { db } from "@/db/client";
import { type FriendLeague, friendDirectory } from "@/db/queries/friends";
import { currentLeague } from "@/db/queries/seasons";
import {
  ACTIVITY_SPORT,
  displayHost,
  groupByActivity,
} from "@/domain/friends/friend-form";
import { env } from "@/env";
import { readUnlessBuildHasNoDatabase } from "@/lib/build-phase";
import { FRIENDS_TAG, PUBLIC_PAGE_LIFE } from "@/lib/public-cache";
import { friendsJsonLd } from "@/lib/seo/structured-data";
import { absoluteUrl, SITE, siteOrigin } from "@/lib/site";

const TITLE = "Friends of the league";

export const metadata: Metadata = {
  title: TITLE,
  description:
    "Softball, soccer, pool, tabletop games and more: other local leagues our players love, and how to link to us from yours.",
  alternates: { canonical: "/friends" },
};

/**
 * Static HTML: the directory is read once inside `use cache` and kept until
 * an admin changes an entry (refreshFriendPages) or PUBLIC_PAGE_LIFE runs
 * out. No Suspense boundary, so the list is part of the first paint
 * (ADR 0029).
 */
export default async function FriendsPage() {
  const entries = await cachedFriendDirectory();
  const origin = siteOrigin(env.BETTER_AUTH_URL);
  const home = absoluteUrl(origin, "/");
  const groups = groupByActivity(entries);
  // The JSON-LD lists entries in the same order the page shows them.
  const ordered = groups.flatMap((g) => g.entries);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 py-10 md:px-6">
      {ordered.length > 0 && (
        <JsonLd
          data={friendsJsonLd(
            { name: TITLE, url: absoluteUrl(origin, "/friends") },
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
          around town. These are the local leagues they love. Give one a try in
          the off-season, and tell them the kickball crowd sent you.
        </p>
      </header>

      {groups.length === 0 ? (
        <p className="rounded-card border border-border bg-surface p-4 text-text-muted">
          The directory is just getting started. Run a local league? Use the
          snippet below to link to us, then let us know.
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          <p className="text-small text-text-muted">
            Each link goes to that league&apos;s own site, which we don&apos;t
            run.
          </p>
          {groups.map((group) => (
            <section
              key={group.activity}
              aria-labelledby={`group-${group.activity}`}
              className="flex flex-col gap-3"
            >
              <h2 id={`group-${group.activity}`} className="text-h2">
                {group.label}
              </h2>
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
async function cachedFriendDirectory(): Promise<FriendLeague[]> {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  cacheTag(FRIENDS_TAG);
  const found = await readUnlessBuildHasNoDatabase(async () => {
    const league = await currentLeague(db);
    return league ? friendDirectory(db, league.id) : [];
  });
  return found ?? [];
}
