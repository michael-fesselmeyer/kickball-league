import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { db } from "@/db/client";
import { myConcernDetail } from "@/db/queries/concerns";
import { CATEGORY_LABELS } from "@/domain/concerns/concerns";
import { type ConcernId, parseId } from "@/domain/ids";
import { requirePermission } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";

export const metadata: Metadata = { title: "Your concern" };

export default function ConcernPage(
  props: PageProps<"/app/concerns/[concern]">,
) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Concern {...props} />
      </Suspense>
    </main>
  );
}

async function Concern({
  params,
  searchParams,
}: PageProps<"/app/concerns/[concern]">) {
  const { concern: rawId } = await params;
  const { notice } = await searchParams;
  const subject = await requirePermission("concern.send", {
    next: `/app/concerns/${rawId}`,
  });
  const id = parseId<ConcernId>(rawId);
  // Someone else's concern reads as missing, the same as one that isn't there.
  const found = id ? await myConcernDetail(db, id, subject.userId) : null;
  if (!found) notFound();
  const league = await activeLeague();
  const when = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: league?.timeZone ?? "America/New_York",
    }).format(d);
  return (
    <>
      <Link href="/app/concerns" className="underline">
        Your concerns
      </Link>
      <h1 className="text-h1">{CATEGORY_LABELS[found.category]}</h1>
      {notice === "sent" && (
        <p role="status">
          Sent. Only the league&apos;s admins can read it. We&apos;ll email you
          when there&apos;s a reply or it&apos;s closed.
        </p>
      )}
      <p className="text-small text-text-muted">
        Sent {when(found.createdAt)} ·{" "}
        {found.status === "open"
          ? "Open"
          : `Closed ${found.closedAt ? when(found.closedAt) : ""}`}
      </p>
      <p className="whitespace-pre-wrap">{found.body}</p>
      <section aria-labelledby="replies" className="flex flex-col gap-3">
        <h2 id="replies" className="text-h2">
          From the league
        </h2>
        {found.replies.length === 0 && !found.outcome && (
          <p className="text-text-muted">No reply yet.</p>
        )}
        <ul className="flex flex-col gap-3">
          {found.replies.map((r) => (
            <li key={r.id} className="border-t border-border pt-3">
              <span className="text-small text-text-muted">
                {when(r.createdAt)}
              </span>
              <p className="whitespace-pre-wrap">{r.body}</p>
            </li>
          ))}
        </ul>
        {found.outcome && (
          <p>
            <strong>Closed. What was done:</strong> {found.outcome}
          </p>
        )}
      </section>
    </>
  );
}
