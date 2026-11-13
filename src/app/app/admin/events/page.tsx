import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/db/client";
import { leagueEvents } from "@/db/queries/events";
import { currentLeague } from "@/db/queries/seasons";
import { KIND_LABELS, whenLine } from "@/domain/events/event";
import { requirePermission } from "@/lib/auth/permission";

export const metadata: Metadata = { title: "Events" };

export default function AdminEventsPage(props: PageProps<"/app/admin/events">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <Suspense fallback={<p className="min-h-svh">Loading events…</p>}>
        <AdminEvents {...props} />
      </Suspense>
    </main>
  );
}

async function AdminEvents({ searchParams }: PageProps<"/app/admin/events">) {
  await requirePermission("event.manage", { next: "/app/admin/events" });
  const query = await searchParams;
  const league = await currentLeague(db);
  const events = league ? await leagueEvents(db, league.id) : [];
  const timeZone = league?.timeZone ?? "America/New_York";
  const now = new Date();
  const upcoming = events.filter((e) => e.endsAt > now);
  const past = events.filter((e) => e.endsAt <= now).reverse();

  const table = (list: typeof events, caption: string) => (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-small text-text-muted">
          <tr>
            <th scope="col" className="py-2 pr-3">
              Event
            </th>
            <th scope="col" className="py-2 pr-3">
              When
            </th>
            <th scope="col" className="py-2 text-right">
              Going
            </th>
            <th scope="col" className="py-2 pl-3 text-right">
              Waitlist
            </th>
          </tr>
        </thead>
        <tbody>
          {list.map((e) => (
            <tr key={e.id} className="border-t border-border align-top">
              <td className="py-2 pr-3">
                <Link
                  href={`/app/admin/events/${e.slug}`}
                  className="inline-flex min-h-11 items-center font-bold underline"
                >
                  {e.title}
                </Link>
                <span className="block text-small text-text-muted">
                  {KIND_LABELS[e.kind]}
                  {e.cancelledAt ? " · called off" : ""}
                </span>
              </td>
              <td className="py-2 pr-3 text-small">{whenLine(e, timeZone)}</td>
              <td className="py-2 text-right tabular-nums">
                {e.kind === "theme_week"
                  ? "—"
                  : e.capacity === null
                    ? e.going
                    : `${e.going} / ${e.capacity}`}
              </td>
              <td className="py-2 pl-3 text-right tabular-nums">
                {e.kind === "theme_week" ? "—" : e.waitlisted}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link href="/app/admin" className="self-start underline">
          League admin
        </Link>
        <h1 className="text-h1">Events</h1>
        <p className="text-text-muted">
          Bar nights, BBQs, tournaments and theme weeks. Theme weeks show on the
          public schedule for their game days.
        </p>
        <p>
          <Link href="/app/admin/events/new" className="btn btn-primary">
            New event
          </Link>
        </p>
      </header>
      {query.deleted && (
        <p role="status" className="rounded-lg border border-success p-3">
          Event deleted.
        </p>
      )}
      <section aria-labelledby="upcoming" className="flex flex-col gap-2">
        <h2 id="upcoming" className="text-h2">
          Coming up
        </h2>
        {upcoming.length === 0 ? (
          <p className="text-text-muted">Nothing planned yet.</p>
        ) : (
          table(upcoming, "Upcoming events")
        )}
      </section>
      {past.length > 0 && (
        <section aria-labelledby="past" className="flex flex-col gap-2">
          <h2 id="past" className="text-h2">
            Past
          </h2>
          {table(past, "Past events")}
        </section>
      )}
    </>
  );
}
