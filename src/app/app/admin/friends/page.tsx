import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/db/client";
import { friendDirectory, storedLogoBytes } from "@/db/queries/friends";
import { currentLeague } from "@/db/queries/seasons";
import { ACTIVITY_LABELS, displayHost } from "@/domain/friends/friend-form";
import { MAX_TOTAL_LOGO_BYTES } from "@/domain/friends/logo";
import { requirePermission } from "@/lib/auth/permission";
import { PageLoading } from "@/components/page-loading";

export const metadata: Metadata = { title: "Friends of the league" };

const PAGE = "/app/admin/friends";

const SAVED: Record<string, string> = {
  created: "League added. It's on the public page now.",
  updated: "Changes saved.",
  removed: "League removed from the directory.",
};

export default function AdminFriendsPage(
  props: PageProps<"/app/admin/friends">,
) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading the directory…</PageLoading>}>
        <AdminFriends {...props} />
      </Suspense>
    </main>
  );
}

const kb = (bytes: number) => `${Math.ceil(bytes / 1024)} KB`;

async function AdminFriends({ searchParams }: PageProps<"/app/admin/friends">) {
  await requirePermission("friends.manage", { next: PAGE });
  const query = await searchParams;
  const league = await currentLeague(db);
  const [entries, logoBytes] = await Promise.all([
    league ? friendDirectory(db, league.id) : [],
    storedLogoBytes(db),
  ]);
  const saved = typeof query.saved === "string" ? SAVED[query.saved] : null;

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link
          href="/app/admin"
          className="inline-flex min-h-11 items-center self-start underline"
        >
          League admin
        </Link>
        <h1 className="text-h1">Friends of the league</h1>
        <p className="text-text-muted">
          Other local leagues our players also play in. They&apos;re listed on
          the public{" "}
          <Link href="/friends" className="underline">
            friends page
          </Link>
          , which also has a snippet they can use to link back to us.
        </p>
        <p>
          <Link href={`${PAGE}/new`} className="btn btn-primary">
            Add a league
          </Link>
        </p>
      </header>
      {saved && (
        <p role="status" className="rounded-lg border border-success p-3">
          {saved}
        </p>
      )}
      {entries.length === 0 ? (
        <p className="text-text-muted">No leagues in the directory yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <caption className="sr-only">Leagues in the directory</caption>
            <thead className="text-small text-text-muted">
              <tr>
                <th scope="col" className="py-2 pr-3">
                  League
                </th>
                <th scope="col" className="py-2 pr-3">
                  Website
                </th>
                <th scope="col" className="py-2">
                  Links back
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-border align-top">
                  <td className="py-2 pr-3">
                    <Link
                      href={`${PAGE}/${e.id}`}
                      className="inline-flex min-h-11 items-center font-bold underline"
                    >
                      {e.name}
                    </Link>
                    <span className="block text-small text-text-muted">
                      {[
                        ACTIVITY_LABELS[e.activity],
                        e.area,
                        e.logo ? "logo" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-small break-all">
                    {displayHost(e.url)}
                  </td>
                  <td className="py-2 text-small">
                    {e.linksBack ? "Yes" : "Not yet"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-small text-text-muted">
        Logos use {kb(logoBytes)} of {kb(MAX_TOTAL_LOGO_BYTES)}.
      </p>
    </>
  );
}
