import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { db } from "@/db/client";
import { moveInterestsForAdmins } from "@/db/queries/move";
import { requirePermission } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";

export const metadata: Metadata = { title: "Players looking for a change" };

export default function TeamChangesPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <TeamChanges />
      </Suspense>
    </main>
  );
}

/**
 * Players quietly open to a new team next season who let admins see it
 * (ADR 0089), with their note, current teams and the teams whose invite they said
 * yes to (never a "no"). Players
 * who chose "captains only" are not here. Never shared with captains.
 */
async function TeamChanges() {
  await requirePermission("move.review", { next: "/app/admin/team-changes" });
  const league = await activeLeague();
  if (!league) notFound();
  const rows = await moveInterestsForAdmins(db, league.id, new Date());
  const day = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: league.timeZone,
    }).format(d);
  return (
    <>
      <header className="flex flex-col gap-2">
        <Link href="/app/admin" className="underline">
          Admin
        </Link>
        <h1 className="text-h1">Looking for a change</h1>
        <p className="text-text-muted">
          Players open to a new team next season who chose to tell admins. Their
          current captains and teammates never see this. Keep it here: if you
          help, reach out to the player, not their team. Each flag clears when
          next season&apos;s registration closes. The free-agent matcher steers
          them toward a different team.
        </p>
      </header>
      {rows.length === 0 ? (
        <p>Nobody right now.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <li
              key={r.userId}
              className="flex flex-col gap-1 rounded-lg border border-border p-4"
            >
              <p className="font-semibold">
                {r.name}{" "}
                <span className="font-normal text-text-muted">
                  · since {day(r.since)}
                </span>
              </p>
              <p>
                <a href={`mailto:${r.email}`} className="underline">
                  {r.email}
                </a>
              </p>
              <p className="text-small text-text-muted">
                {r.teams.length > 0
                  ? `Plays for ${r.teams.join(", ")}`
                  : "Not on a team this season"}
                {r.audience === "both"
                  ? " · recruiting captains see a count"
                  : " · admins only"}
              </p>
              {r.note && <p>{r.note}</p>}
              {r.saidYesTo.length > 0 && (
                <p className="text-small">
                  Said yes to {r.saidYesTo.join(", ")}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
