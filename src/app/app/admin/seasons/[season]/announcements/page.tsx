import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import {
  ANNOUNCE_ERRORS,
  AnnouncementForm,
  AnnouncementList,
  announceNotice,
} from "@/components/announcements";
import { db } from "@/db/client";
import {
  announcementsOf,
  DAILY_LIMIT,
  teamsToAnnounceTo,
} from "@/db/queries/announcements";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { requirePermission } from "@/lib/auth/permission";
import { sendLeagueAnnouncementAction } from "./actions";

export const metadata: Metadata = { title: "Announcements" };

export default function AnnouncementsPage(
  props: PageProps<"/app/admin/seasons/[season]/announcements">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<p>Loading…</p>}>
        <Announcements {...props} />
      </Suspense>
    </main>
  );
}

async function Announcements({
  params,
  searchParams,
}: PageProps<"/app/admin/seasons/[season]/announcements">) {
  const { season: slug } = await params;
  const query = await searchParams;
  await requirePermission("announcement.send", {
    next: `/app/admin/seasons/${slug}/announcements`,
    scope: "league",
  });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  const teams = await teamsToAnnounceTo(db, season.id);
  const past = await announcementsOf(db, season.id);
  const names = new Map(teams.map((t) => [t.id as string, t.name]));
  const when = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: season.timeZone,
    }).format(d);
  const error =
    typeof query.error === "string" ? ANNOUNCE_ERRORS[query.error] : undefined;
  const notice = announceNotice(query.sent);

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href={`/app/admin/seasons/${slug}`} className="underline">
          {season.name}
        </Link>
        <h1 className="text-h1">Announcements</h1>
        <p className="text-text-muted">
          Email everyone registered for {season.name}, or one team.
        </p>
        <Link href={`/app/admin/seasons/${slug}/recap`} className="underline">
          Draft this week&apos;s recap
        </Link>
      </header>
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg border border-success p-3">
          {notice}
        </p>
      )}
      <section aria-labelledby="write" className="flex flex-col gap-3">
        <h2 id="write" className="text-h2">
          Write an announcement
        </h2>
        <AnnouncementForm
          action={sendLeagueAnnouncementAction.bind(null, slug)}
          audience={[
            { value: "league", label: `Everyone in ${season.name}` },
            ...teams.map((t) => ({ value: t.id, label: t.name })),
          ]}
          limitNote={`Up to ${DAILY_LIMIT.admin} a day.`}
        />
      </section>
      <section aria-labelledby="sent" className="flex flex-col gap-3">
        <h2 id="sent" className="text-h2">
          Sent
        </h2>
        <AnnouncementList
          items={past}
          when={when}
          teamName={(id) => (id ? (names.get(id) ?? "A team") : "Everyone")}
        />
      </section>
    </>
  );
}
