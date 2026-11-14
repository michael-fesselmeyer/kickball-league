import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { friendLeagueById } from "@/db/queries/friends";
import { currentLeague } from "@/db/queries/seasons";
import { type FriendLeagueId, parseId } from "@/domain/ids";
import { requirePermission } from "@/lib/auth/permission";
import {
  removeFriendAction,
  removeFriendLogoAction,
  updateFriendAction,
} from "../actions";
import { FriendFormFields } from "../friend-form";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Edit a league" };

type Props = PageProps<"/app/admin/friends/[friend]">;

export default function EditFriendPage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <EditFriend {...props} />
      </Suspense>
    </main>
  );
}

async function EditFriend({ params, searchParams }: Props) {
  const { friend } = await params;
  const page = `/app/admin/friends/${friend}`;
  await requirePermission("friends.manage", { next: page });
  const id = parseId<FriendLeagueId>(friend);
  const league = await currentLeague(db);
  const entry = id && league ? await friendLeagueById(db, league.id, id) : null;
  if (!entry) notFound();
  const query = await searchParams;

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link
          href="/app/admin/friends"
          className="inline-flex min-h-11 items-center self-start underline"
        >
          Friends of the league
        </Link>
        <h1 className="text-h1">{entry.name}</h1>
      </header>
      {query.saved === "logo_removed" && (
        <p role="status" className="rounded-lg border border-success p-3">
          Logo removed.
        </p>
      )}
      {query.error === "confirm" && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          Tick the box to confirm, then remove the league.
        </p>
      )}
      <FriendFormFields
        action={updateFriendAction.bind(null, entry.id)}
        values={{
          name: entry.name,
          activity: entry.activity,
          area: entry.area ?? "",
          description: entry.description ?? "",
          url: entry.url,
          linksBack: entry.linksBack,
        }}
        submitLabel="Save changes"
        hasLogo={entry.logo !== null}
      />
      {entry.logo && (
        <section
          aria-labelledby="logo"
          className="flex flex-col gap-3 rounded-card border border-border p-4"
        >
          <h2 id="logo" className="text-h3">
            Current logo
          </h2>
          {/* eslint-disable-next-line @next/next/no-img-element -- a small stored copy, served as is */}
          <img
            src={`/media/friends/${entry.logo.id}`}
            alt={`${entry.name} logo`}
            width={entry.logo.width}
            height={entry.logo.height}
            className="size-16 rounded-md bg-surface object-contain"
          />
          <form action={removeFriendLogoAction.bind(null, entry.id)}>
            <SubmitButton className="btn btn-secondary">
              Remove the logo
            </SubmitButton>
          </form>
        </section>
      )}
      <section
        aria-labelledby="remove"
        className="flex flex-col gap-3 rounded-card border border-danger p-4"
      >
        <h2 id="remove" className="text-h3">
          Remove from the directory
        </h2>
        <form
          action={removeFriendAction.bind(null, entry.id)}
          className="flex flex-col gap-3"
        >
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              name="confirm"
              value="yes"
              className="size-5"
            />
            Yes, take {entry.name} off the friends page
          </label>
          <SubmitButton className="btn self-start btn-secondary">
            Remove the league
          </SubmitButton>
        </form>
      </section>
    </>
  );
}
