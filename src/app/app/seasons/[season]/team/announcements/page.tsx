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
import { announcementsOf, DAILY_LIMIT } from "@/db/queries/announcements";
import {
  myRegistration,
  seasonForRegistration,
} from "@/db/queries/registration";
import { currentLeague } from "@/db/queries/seasons";
import { can } from "@/domain/authz/permissions";
import { requirePermission } from "@/lib/auth/permission";
import { sendTeamAnnouncementAction } from "./actions";

export const metadata: Metadata = { title: "Message your team" };

export default function TeamAnnouncementsPage(
  props: PageProps<"/app/seasons/[season]/team/announcements">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<p>Loading…</p>}>
        <TeamAnnouncements {...props} />
      </Suspense>
    </main>
  );
}

async function TeamAnnouncements({
  params,
  searchParams,
}: PageProps<"/app/seasons/[season]/team/announcements">) {
  const { season: slug } = await params;
  const query = await searchParams;
  const subject = await requirePermission("registration.join", {
    next: `/app/seasons/${slug}/team/announcements`,
  });
  const league = await currentLeague(db);
  const season = league
    ? await seasonForRegistration(db, league.id, slug)
    : null;
  if (!season) notFound();
  const mine = await myRegistration(db, season.id, subject.userId);
  const team = mine?.team;
  if (
    !team ||
    !can(subject, "announcement.send", {
      scope: "team",
      teamSeasonId: team.teamSeasonId,
    })
  )
    notFound();
  const past = await announcementsOf(db, season.id, team.teamSeasonId);
  const when = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: league?.timeZone ?? "America/New_York",
    }).format(d);
  const error =
    typeof query.error === "string" ? ANNOUNCE_ERRORS[query.error] : undefined;
  const notice = announceNotice(query.sent);

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href={`/app/seasons/${slug}/team`} className="underline">
          {team.teamName}
        </Link>
        <h1 className="text-h1">Message your team</h1>
        <p className="text-text-muted">
          Emails everyone on {team.teamName}&apos;s roster. For quick chat, your
          team&apos;s group thread is still the place.
        </p>
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
          Write to your team
        </h2>
        <AnnouncementForm
          action={sendTeamAnnouncementAction.bind(null, slug)}
          limitNote={`Up to ${DAILY_LIMIT.captain} a day, so it stays worth reading.`}
        />
      </section>
      <section aria-labelledby="sent" className="flex flex-col gap-3">
        <h2 id="sent" className="text-h2">
          Sent to the team
        </h2>
        <AnnouncementList items={past} when={when} />
      </section>
    </>
  );
}
