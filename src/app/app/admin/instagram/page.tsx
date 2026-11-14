import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { currentLeague } from "@/db/queries/seasons";
import {
  type AdminPost,
  adminPosts,
  instagramAccount,
  taggableEvents,
  taggableTeams,
} from "@/db/queries/social";
import { altFor, isShown } from "@/domain/social/sync-plan";
import { requirePermission } from "@/lib/auth/permission";
import { instagramConfig } from "@/lib/social/instagram-app";
import { instagramSettings } from "@/lib/social/instagram-settings";
import {
  connectInstagramAction,
  disconnectInstagramAction,
  savePostDetailsAction,
  showNewestAction,
  syncNowAction,
  togglePostAction,
} from "./actions";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Instagram photos" };

const PAGE = "/app/admin/instagram";

export default function InstagramPage(
  props: PageProps<"/app/admin/instagram">,
) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Instagram {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<string, string> = {
  off: "Instagram isn't set up on this site yet.",
  state:
    "That sign-in link was old or came from somewhere else. Start again from Connect Instagram.",
  denied: "Instagram didn't connect. Nothing was changed.",
  sign_in:
    "Instagram refused the sign-in. Check that it is the league's professional account and try again.",
  not_connected: "Connect Instagram first.",
  sync: "The sync didn't finish. The reason is shown on the connection card.",
  not_found: "That post is gone; it may have been deleted on Instagram.",
  unknown_team: "Pick one of the league's teams.",
  unknown_event: "Pick one of the league's events.",
  cover_needs_team: "Tag a team before making the photo that team's cover.",
  alt_too_long: "Keep the description under 300 characters.",
};

const DONE: Record<string, string> = {
  connected: "Instagram is connected.",
  synced: "Synced.",
  disconnected:
    "Instagram is disconnected. The photos already on the site stay up.",
  removed: "Instagram is disconnected and its photos are removed.",
  newest_on: "New posts now show on the site as they sync.",
  newest_off: "Only featured posts show on the site.",
  saved: "Saved.",
};

const day = (d: Date) =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "America/New_York",
  }).format(d);

const when = (d: Date) =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  }).format(d);

const input =
  "min-h-11 rounded-md border border-border-strong bg-surface px-2 py-1";

async function Instagram({ searchParams }: PageProps<"/app/admin/instagram">) {
  await requirePermission("photos.manage", { next: PAGE });
  const query = await searchParams;
  const league = await currentLeague(db);
  if (!league) notFound();
  const [account, posts, teams, events] = await Promise.all([
    instagramAccount(db, league.id),
    adminPosts(db, league.id),
    taggableTeams(db, league.id),
    taggableEvents(db, league.id),
  ]);
  const config = instagramConfig();
  // Names a half or malformed setting (never its value) for whoever fixes it.
  const settingsProblem = config ? null : instagramSettings(process.env);
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const done = typeof query.done === "string" ? DONE[query.done] : undefined;
  const added = typeof query.added === "string" ? Number(query.added) : null;
  const showNewest = account?.showNewest ?? false;

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href="/app/admin" className="underline">
          League admin
        </Link>
        <h1 className="text-h1">Instagram photos</h1>
        <p className="max-w-prose text-text-muted">
          Recent posts from the league&apos;s Instagram are copied here. Feature
          the ones to show on the home page, tag them to a team, or hide any you
          don&apos;t want on the site. Every photo links back to its post.
        </p>
      </header>

      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="rounded-lg border border-success p-3">
          {done}
          {added !== null && Number.isInteger(added) && added > 0
            ? ` ${added === 1 ? "1 new post" : `${added} new posts`} copied.`
            : ""}
        </p>
      )}

      <section
        aria-labelledby="connection"
        className="flex flex-col gap-4 rounded-card border-2 border-text bg-surface p-4 md:p-6"
      >
        <h2 id="connection" className="text-h2">
          Connection
        </h2>
        {!config && (
          <p className="max-w-prose">
            Instagram isn&apos;t set up on this site. It needs a Meta developer
            app for the league&apos;s professional account; once its ID and
            secret are added to the site&apos;s settings, you can connect here.
            {account && " Photos synced earlier stay as they are."}
          </p>
        )}
        {settingsProblem && !settingsProblem.on && settingsProblem.reason && (
          <p className="max-w-prose text-text-muted">
            {settingsProblem.reason}
          </p>
        )}
        {account && account.status !== "disconnected" ? (
          <>
            <dl className="grid gap-2 sm:grid-cols-[max-content_1fr] sm:gap-x-6">
              <dt className="font-bold">Account</dt>
              <dd>@{account.username}</dd>
              <dt className="font-bold">Status</dt>
              <dd>
                {account.status === "active"
                  ? "Connected"
                  : "Needs reconnecting: Instagram stopped accepting the connection. Photos already here stay up."}
              </dd>
              <dt className="font-bold">Last sync</dt>
              <dd>
                {account.lastSyncedAt ? when(account.lastSyncedAt) : "Not yet"}
              </dd>
              {account.lastError && (
                <>
                  <dt className="font-bold">Last problem</dt>
                  <dd>{account.lastError}</dd>
                </>
              )}
            </dl>
            <div className="flex flex-wrap gap-3">
              {account.status === "active"
                ? config && (
                    <form action={syncNowAction}>
                      <SubmitButton className="btn btn-secondary">
                        Sync now
                      </SubmitButton>
                    </form>
                  )
                : config && (
                    <form action={connectInstagramAction}>
                      <SubmitButton className="btn btn-primary">
                        Reconnect Instagram
                      </SubmitButton>
                    </form>
                  )}
            </div>
            <form
              action={showNewestAction}
              className="flex flex-wrap items-center gap-3"
            >
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  name="showNewest"
                  defaultChecked={showNewest}
                  className="size-5"
                />
                Show new posts on the site without featuring each one
              </label>
              <SubmitButton className="btn btn-secondary">Save</SubmitButton>
            </form>
            <details className="rounded-lg border border-border p-3">
              <summary className="min-h-11 cursor-pointer content-center font-bold">
                Disconnect Instagram
              </summary>
              <form
                action={disconnectInstagramAction}
                className="mt-3 flex flex-col gap-3"
              >
                <p>
                  The sync stops and the saved sign-in is deleted. What should
                  happen to the photos already on the site?
                </p>
                <fieldset className="flex flex-col gap-2">
                  <legend className="sr-only">Synced photos</legend>
                  <label className="flex min-h-11 items-center gap-2">
                    <input
                      type="radio"
                      name="photos"
                      value="keep"
                      defaultChecked
                    />
                    Keep them up
                  </label>
                  <label className="flex min-h-11 items-center gap-2">
                    <input type="radio" name="photos" value="delete" />
                    Remove them from the site
                  </label>
                </fieldset>
                <p>
                  <SubmitButton className="btn btn-secondary">
                    Disconnect
                  </SubmitButton>
                </p>
              </form>
            </details>
          </>
        ) : (
          config && (
            <div className="flex flex-col gap-3">
              <p className="max-w-prose">
                Sign in on Instagram&apos;s own screen with the league&apos;s
                account. It must be a professional (Business or Creator)
                account. The site only reads posts; it never posts or comments.
              </p>
              <form action={connectInstagramAction}>
                <SubmitButton className="btn btn-primary">
                  Connect Instagram
                </SubmitButton>
              </form>
            </div>
          )
        )}
      </section>

      <section aria-labelledby="posts" className="flex flex-col gap-4">
        <h2 id="posts" className="text-h2">
          Posts
        </h2>
        {posts.length === 0 ? (
          <p className="text-text-muted">
            No posts yet. They appear here after the first sync.
          </p>
        ) : (
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                teams={teams}
                events={events}
                showNewest={showNewest}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function PostCard({
  post,
  teams,
  events,
  showNewest,
}: {
  post: AdminPost;
  teams: { id: string; name: string }[];
  events: { id: string; title: string; startsAt: Date }[];
  showNewest: boolean;
}) {
  const shown = isShown(post, showNewest);
  const status = post.hidden
    ? "Hidden"
    : shown
      ? post.cover === "home"
        ? "Home page cover"
        : post.cover === "team"
          ? "Team page cover"
          : post.featured
            ? "Featured"
            : "Shown (newest)"
      : "Not shown yet";
  const labelId = `post-${post.id}-label`;
  return (
    <li
      id={`post-${post.id}`}
      aria-labelledby={labelId}
      className="flex flex-col gap-3 rounded-card border border-border-strong bg-surface p-3"
    >
      {post.imageId ? (
        // The admin's photo route checks permission, so the public image
        // optimizer cannot fetch it; these are small enough as they are.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`${PAGE}/photos/${post.imageId}`}
          alt={altFor(post)}
          width={320}
          height={320}
          loading="lazy"
          decoding="async"
          className={`aspect-square w-full rounded-lg object-cover ${post.hidden ? "opacity-50" : ""}`}
        />
      ) : (
        <div className="aspect-square w-full rounded-lg bg-surface-2" />
      )}
      <div className="flex flex-col gap-1">
        <p id={labelId} className="font-bold">
          {day(post.takenAt)} · {status}
        </p>
        {post.caption && (
          <p className="line-clamp-3 text-small text-text-muted">
            {post.caption}
          </p>
        )}
        <a
          href={post.permalink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center text-small underline"
        >
          View on Instagram
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
      <div className="flex flex-wrap gap-2">
        <form
          action={togglePostAction.bind(
            null,
            post.id,
            "feature",
            !post.featured,
          )}
        >
          <SubmitButton className="btn btn-secondary">
            {post.featured ? "Unfeature" : "Feature"}
          </SubmitButton>
        </form>
        <form
          action={togglePostAction.bind(null, post.id, "hide", !post.hidden)}
        >
          <SubmitButton className="btn btn-secondary">
            {post.hidden ? "Unhide" : "Hide"}
          </SubmitButton>
        </form>
      </div>
      <details>
        <summary className="min-h-11 cursor-pointer content-center font-bold">
          Team, event, cover and description
        </summary>
        <form
          action={savePostDetailsAction.bind(null, post.id)}
          className="mt-2 flex flex-col gap-3"
        >
          <label className="flex flex-col gap-1 text-small font-bold">
            Team
            <select
              name="teamId"
              defaultValue={post.teamId ?? ""}
              className={input}
            >
              <option value="">No team</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-small font-bold">
            Event
            <select
              name="eventId"
              defaultValue={post.eventId ?? ""}
              className={input}
            >
              <option value="">No event</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title} ({day(e.startsAt)})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-small font-bold">
            Cover photo of
            <select
              name="cover"
              defaultValue={post.cover ?? ""}
              className={input}
            >
              <option value="">Nothing</option>
              <option value="home">The home page</option>
              <option value="team">Its team&apos;s page</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-small font-bold">
            Description for screen readers
            <textarea
              name="altText"
              defaultValue={post.altText ?? ""}
              maxLength={300}
              rows={2}
              placeholder={altFor({ altText: null, caption: post.caption })}
              className={input}
            />
          </label>
          <p>
            <SubmitButton className="btn btn-secondary">Save</SubmitButton>
          </p>
        </form>
      </details>
    </li>
  );
}
