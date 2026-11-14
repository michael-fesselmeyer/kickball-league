import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/db/client";
import {
  activeSuspensions,
  incidentQueue,
  type QueueRow,
} from "@/db/queries/discipline";
import { currentLeague } from "@/db/queries/seasons";
import { INCIDENT_KINDS } from "@/domain/discipline/discipline";
import { requirePermission } from "@/lib/auth/permission";
import { requireFeature } from "@/lib/platform/site";
import { REPORTED_BY, suspensionLine } from "./words";
import { PageLoading } from "@/components/page-loading";

export const metadata: Metadata = { title: "Incidents" };

export default function IncidentsPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading reports…</PageLoading>}>
        <Incidents />
      </Suspense>
    </main>
  );
}

function Row({ r, when }: { r: QueueRow; when: (d: Date) => string }) {
  return (
    <li className="flex flex-col gap-1 border-t border-border py-3">
      <Link href={`/app/admin/incidents/${r.id}`} className="underline">
        <strong>{INCIDENT_KINDS[r.kind]}</strong>: {r.matchup}
      </Link>
      <span className="text-small text-text-muted">
        {r.seasonName} · reported by {REPORTED_BY[r.reporterRole]},{" "}
        {when(r.reportedAt)} ·{" "}
        {r.people === 1 ? "1 person" : `${r.people} people`} named
      </span>
    </li>
  );
}

async function Incidents() {
  await requireFeature("discipline");
  await requirePermission("incident.review", { next: "/app/admin/incidents" });
  const now = new Date();
  const [queue, suspended, league] = await Promise.all([
    incidentQueue(db),
    activeSuspensions(db, now),
    currentLeague(db),
  ]);
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
      <header className="flex flex-col gap-1">
        <Link href="/app/admin" className="underline">
          League admin
        </Link>
        <h1 className="text-h1">Incidents</h1>
        <p className="text-text-muted">
          Reports from refs, captains and admins. Read each one, add notes,
          suspend a player if it calls for it, and resolve it.
        </p>
      </header>
      <section aria-labelledby="open" className="flex flex-col gap-1">
        <h2 id="open" className="text-h2">
          To review ({queue.open.length})
        </h2>
        {queue.open.length === 0 ? (
          <p className="text-text-muted">Nothing to review.</p>
        ) : (
          <ul>
            {queue.open.map((r) => (
              <Row key={r.id} r={r} when={when} />
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="suspended" className="flex flex-col gap-1">
        <h2 id="suspended" className="text-h2">
          Suspended now ({suspended.length})
        </h2>
        {suspended.length === 0 ? (
          <p className="text-text-muted">Nobody is suspended.</p>
        ) : (
          <ul>
            {suspended.map((s) => (
              <li
                key={s.id}
                className="flex flex-col gap-1 border-t border-border py-3"
              >
                <strong>{s.name}</strong>
                <span className="text-small text-text-muted">
                  {suspensionLine(s)} ·{" "}
                  <Link
                    href={`/app/admin/incidents/${s.incidentId}#suspensions`}
                    className="underline"
                  >
                    See the report
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="resolved" className="flex flex-col gap-1">
        <h2 id="resolved" className="text-h2">
          Recently resolved
        </h2>
        {queue.resolved.length === 0 ? (
          <p className="text-text-muted">No reports resolved yet.</p>
        ) : (
          <ul>
            {queue.resolved.map((r) => (
              <Row key={r.id} r={r} when={when} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
