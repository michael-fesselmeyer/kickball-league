import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { alertChoiceCounts } from "@/db/queries/alert-choices";
import { PageLoading } from "@/components/page-loading";
import { requirePermission } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";

export const metadata: Metadata = { title: "Alert choices" };

export default function AlertChoicesPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading alert choices…</PageLoading>}>
        <AlertChoices />
      </Suspense>
    </main>
  );
}

/**
 * How members choose their alerts (issue #529): counts per topic, never
 * who. Opted in counts members who get the topic by email; turned down
 * counts "No thanks" on the in-app card that offers it; unsubscribed counts
 * turn-offs from an email's link.
 */
async function AlertChoices() {
  await requirePermission("season.manage", { next: "/app/admin/alerts" });
  const league = await activeLeague();
  if (!league) notFound();
  const counts = await alertChoiceCounts(db, league.id, new Date());
  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href="/app/admin" className="underline">
          League admin
        </Link>
        <h1 className="text-h1">Alert choices</h1>
        <p className="text-text-muted">
          What {counts.members} {counts.members === 1 ? "member" : "members"}{" "}
          chose, as counts only. Nobody is tracked one by one.
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-small">
          <caption className="sr-only">Alert choices per topic</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="py-2 pr-3">
                Topic
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                Opted in (email)
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                Phone alerts on
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                Turned down
              </th>
              <th scope="col" className="py-2 text-right">
                Unsubscribed
              </th>
            </tr>
          </thead>
          <tbody>
            {counts.topics.map((t) => (
              <tr key={t.topic} className="border-b border-border">
                <th scope="row" className="py-2 pr-3 font-normal">
                  {t.label}
                </th>
                <td className="py-2 pr-3 text-right tabular-nums">{t.email}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{t.push}</td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {t.turnedDown}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {t.unsubscribed}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section aria-labelledby="fewer" className="flex flex-col gap-2">
        <h2 id="fewer" className="text-h3">
          Fewer messages, not none
        </h2>
        <ul className="flex flex-col gap-1">
          <li>Only their team&apos;s news: {counts.teamOnly}</li>
          <li>League news as a weekly roundup: {counts.weeklyNews}</li>
          <li>Snoozed right now: {counts.snoozed}</li>
        </ul>
      </section>
    </>
  );
}
