import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/db/client";
import { seasonsForAdmin } from "@/db/queries/schedule-screen";
import { requirePermission } from "@/lib/auth/permission";
import { PageLoading } from "@/components/page-loading";

export const metadata: Metadata = { title: "Seasons" };

export default function SeasonsPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Seasons />
      </Suspense>
    </main>
  );
}

const STATUS_NAMES: Record<string, string> = {
  draft: "Draft",
  registration_open: "Registration open",
  registration_closed: "Registration closed",
  in_progress: "In progress",
  playoffs: "Playoffs",
  completed: "Completed",
};

async function Seasons() {
  await requirePermission("season.manage", { next: "/app/admin/seasons" });
  const seasons = await seasonsForAdmin(db);
  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-h1">Seasons</h1>
        <div className="flex flex-wrap gap-3">
          <Link href="/app/admin" className="btn btn-secondary">
            Admin home
          </Link>
          <Link href="/app/admin/waivers" className="btn btn-secondary">
            Waivers
          </Link>
          <Link href="/app/admin/seasons/new" className="btn btn-primary">
            New season
          </Link>
        </div>
      </header>
      {seasons.length === 0 ? (
        <p>No seasons yet.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {seasons.map((s) => (
            <li
              key={s.slug}
              className="flex flex-col gap-1 border-b border-border pb-4"
            >
              <p>
                <Link
                  href={`/app/admin/seasons/${s.slug}`}
                  className="text-h3 underline"
                >
                  {s.name}
                </Link>{" "}
                <span className="text-text-muted">
                  · {STATUS_NAMES[s.status] ?? s.status}
                </span>
              </p>
              <p className="flex flex-wrap gap-4">
                <Link
                  href={`/app/admin/seasons/${s.slug}/fields`}
                  className="underline"
                >
                  Fields and permits
                </Link>
                <Link
                  href={`/app/admin/seasons/${s.slug}/schedule`}
                  className="underline"
                >
                  Schedule
                </Link>
                <Link
                  href={`/app/admin/seasons/${s.slug}/registrations`}
                  className="underline"
                >
                  Registrations
                </Link>
                <Link
                  href={`/app/admin/seasons/${s.slug}/scores`}
                  className="underline"
                >
                  Scores
                </Link>
                <Link
                  href={`/app/admin/seasons/${s.slug}/referees`}
                  className="underline"
                >
                  Referees
                </Link>
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
