import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { db } from "@/db/client";
import { myConcerns } from "@/db/queries/concerns";
import { CATEGORY_LABELS } from "@/domain/concerns/concerns";
import { requirePermission } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";

export const metadata: Metadata = { title: "Your concerns" };

export default function ConcernsPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Concerns />
      </Suspense>
    </main>
  );
}

async function Concerns() {
  const subject = await requirePermission("concern.send", {
    next: "/app/concerns",
  });
  const [rows, league] = await Promise.all([
    myConcerns(db, subject.userId),
    activeLeague(),
  ]);
  const when = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: league?.timeZone ?? "America/New_York",
    }).format(d);
  return (
    <>
      <h1 className="text-h1">Your concerns</h1>
      <p className="text-text-muted">
        What you&apos;ve sent the league privately, and its answers. Only you
        and the league&apos;s admins can see them.
      </p>
      <Link href="/app/concerns/new" className="btn self-start btn-primary">
        Raise a concern
      </Link>
      {rows.length === 0 ? (
        <p className="text-text-muted">You haven&apos;t sent any.</p>
      ) : (
        <ul>
          {rows.map((c) => (
            <li
              key={c.id}
              className="flex flex-col gap-1 border-t border-border py-3"
            >
              <Link href={`/app/concerns/${c.id}`} className="underline">
                {CATEGORY_LABELS[c.category]}
              </Link>
              <span className="text-small text-text-muted">
                Sent {when(c.createdAt)} ·{" "}
                {c.status === "open" ? "Open" : "Closed"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
