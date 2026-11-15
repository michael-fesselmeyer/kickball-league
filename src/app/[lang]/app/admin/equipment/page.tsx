import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/db/client";
import { leagueKits } from "@/db/queries/equipment";
import { activeLeague } from "@/lib/league/active";
import { dayWords, whereabouts } from "@/domain/equipment/equipment";
import { kickoff } from "@/domain/schedule/format";
import { requirePermission } from "@/lib/auth/permission";
import { createKitAction } from "./actions";
import { KitFields } from "./kit-fields";
import { ADMIN_GEAR_ERRORS, ADMIN_GEAR_NOTICES } from "./words";

export const metadata: Metadata = { title: "League gear" };

/**
 * Where every kit of league gear is right now (issue #286): with whom, on
 * its way, or at home; its next game; open missing-items reports. And the
 * form to add a kit.
 */
export default function EquipmentPage(
  props: PageProps<"/[lang]/app/admin/equipment">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<p className="min-h-svh">Loading the gear…</p>}>
        <Equipment {...props} />
      </Suspense>
    </main>
  );
}

async function Equipment({ searchParams }: PageProps<"/[lang]/app/admin/equipment">) {
  await requirePermission("equipment.manage", {
    next: "/app/admin/equipment",
  });
  const query = await searchParams;
  const league = await activeLeague();
  const now = new Date();
  const kits = league ? await leagueKits(db, league.id, now) : [];
  const timeZone = league?.timeZone ?? "America/New_York";
  const error =
    typeof query.error === "string" ? ADMIN_GEAR_ERRORS[query.error] : null;
  const notice =
    typeof query.notice === "string" ? ADMIN_GEAR_NOTICES[query.notice] : null;

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href="/app/admin" className="underline">
          League admin
        </Link>
        <h1 className="text-h1">League gear</h1>
        <p className="text-text-muted">
          Where every kit is right now. Assign a kit to a game and whoever
          brings it sees it on their home screen, with a reminder the evening
          before.
        </p>
        {notice && (
          <p role="status" className="rounded-lg border border-success p-3">
            {notice}
          </p>
        )}
      </header>

      <section aria-labelledby="kits" className="flex flex-col gap-2">
        <h2 id="kits" className="text-h2">
          Kits
        </h2>
        {kits.length === 0 ? (
          <p className="text-text-muted">No kits yet. Add the first below.</p>
        ) : (
          <ul>
            {kits.map((k) => (
              <li
                key={k.id}
                className="flex flex-col gap-1 border-t border-border py-3"
              >
                <Link
                  href={`/app/admin/equipment/${k.id}`}
                  className="inline-flex min-h-11 items-center font-bold underline"
                >
                  {k.name}
                </Link>
                <span>
                  {whereabouts({
                    holderId: k.holderId,
                    holderName: k.holderName,
                    homeLocation: k.homeLocation,
                    pendingToName: k.pending ? (k.pending.toName ?? "") : null,
                  })}
                </span>
                <span className="text-small text-text-muted">
                  {k.next
                    ? `Next: ${k.next.name}, ${k.next.place}, ${dayWords(k.next.startsAt, now, timeZone)} at ${kickoff(k.next.startsAt, timeZone)}`
                    : "Not assigned to a game"}
                </span>
                {k.openReports > 0 && (
                  <span className="text-small font-bold text-danger">
                    {k.openReports === 1
                      ? "1 missing-items report"
                      : `${k.openReports} missing-items reports`}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="add" className="flex flex-col gap-3">
        <h2 id="add" className="text-h2">
          Add a kit
        </h2>
        {error && (
          <p role="alert" className="rounded-lg border border-danger p-3">
            {error}
          </p>
        )}
        <KitFields action={createKitAction} submit="Add kit" />
      </section>
    </>
  );
}
