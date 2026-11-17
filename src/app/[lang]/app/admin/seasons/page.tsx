import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/db/client";
import { seasonsForAdmin } from "@/db/queries/schedule-screen";
import { requirePermission } from "@/lib/auth/permission";
import { activeLeagueId } from "@/lib/league/active";
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

/** Which seasons come first: the one being played, then the next, then the past. */
const STATUS_ORDER: Record<string, number> = {
  in_progress: 0,
  playoffs: 0,
  registration_open: 1,
  registration_closed: 1,
  draft: 2,
  completed: 3,
};

/** A status chip's look: the live season stands out, a past one recedes. */
function chipClass(status: string): string {
  if (status === "in_progress" || status === "playoffs")
    return "border-text bg-highlight text-on-highlight";
  if (status === "completed") return "border-border text-text-muted";
  return "border-border-strong";
}

async function Seasons() {
  await requirePermission("season.manage", { next: "/app/admin/seasons" });
  const leagueId = await activeLeagueId();
  const listed = leagueId ? await seasonsForAdmin(db, leagueId) : [];
  // Stable sort: within a group the newest season stays first.
  const seasons = [...listed].sort(
    (a, b) => (STATUS_ORDER[a.status] ?? 2) - (STATUS_ORDER[b.status] ?? 2),
  );
  return (
    <>
      <header className="flex flex-col gap-4">
        <h1 className="text-h1">Seasons</h1>
        <div className="flex flex-wrap gap-3">
          <Link href="/app/admin/seasons/new" className="btn btn-primary">
            New season
          </Link>
          <Link href="/app/admin/waivers" className="btn btn-secondary">
            Waivers
          </Link>
        </div>
      </header>
      {seasons.length === 0 ? (
        <p>No seasons yet.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {seasons.map((s) => (
            <li
              key={s.slug}
              className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
            >
              <div className="flex flex-col items-start gap-2">
                <h2 className="text-h3">{s.name}</h2>
                <p className="flex flex-wrap gap-2 text-small">
                  <span
                    className={`rounded-full border px-2 py-0.5 font-bold ${chipClass(s.status)}`}
                  >
                    {STATUS_NAMES[s.status] ?? s.status}
                  </span>
                  {s.visibility === "private" && (
                    <span className="rounded-full border border-border px-2 py-0.5">
                      Private event
                    </span>
                  )}
                </p>
              </div>
              <Link
                href={`/app/admin/seasons/${s.slug}`}
                className={`mt-auto btn self-start ${
                  STATUS_ORDER[s.status] === 0 ? "btn-primary" : "btn-secondary"
                }`}
                aria-label={`Manage ${s.name}`}
              >
                Manage
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
