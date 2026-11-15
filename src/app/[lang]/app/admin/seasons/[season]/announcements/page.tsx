import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import {
  ANNOUNCE_ERRORS,
  AnnouncementForm,
  AnnouncementList,
  announceNotice,
  type ScheduleChoice,
} from "@/components/announcements";
import { PageLoading } from "@/components/page-loading";
import { CopyForWhatsApp } from "@/components/share";
import { SubmitButton } from "@/components/submit-button";
import { db } from "@/db/client";
import {
  announcementsOf,
  BODY_MAX,
  DAILY_LIMIT,
  type ScheduledAnnouncement,
  scheduledAnnouncements,
  SUBJECT_MAX,
  teamsToAnnounceTo,
} from "@/db/queries/announcements";
import { publishedSchedule } from "@/db/queries/public-schedule";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { MAX_DAYS_AHEAD, nextSweep } from "@/domain/messaging/send-time";
import { dayHeading, kickoff } from "@/domain/schedule/format";
import { groupByDay, localDay, placeLine } from "@/domain/schedule/public-game";
import {
  announcementShareText,
  gameDayShareText,
} from "@/domain/share/share-text";
import { env } from "@/env";
import { requirePermission } from "@/lib/auth/permission";
import { requireFeature } from "@/lib/platform/site";
import { activeLeagueId } from "@/lib/league/active";
import { absoluteUrl, siteOrigin } from "@/lib/site";
import {
  cancelScheduledAction,
  editScheduledAction,
  sendLeagueAnnouncementAction,
} from "./actions";

export const metadata: Metadata = { title: "Announcements" };

/** How many upcoming game days to offer for the group chat. */
const GAME_DAYS_TO_SHARE = 3;

const NOTICES: Record<string, string> = {
  scheduled:
    "Scheduled. It goes out with the morning send on that day; edit or cancel it below until then.",
  edited: "Saved the changes to the scheduled announcement.",
  cancelled: "Cancelled. It won't be sent.",
};

const field = "rounded-md border border-border bg-surface px-2 py-1";

export default function AnnouncementsPage(
  props: PageProps<"/app/admin/seasons/[season]/announcements">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Announcements {...props} />
      </Suspense>
    </main>
  );
}

async function Announcements({
  params,
  searchParams,
}: PageProps<"/app/admin/seasons/[season]/announcements">) {
  await requireFeature("announcements");
  const { season: slug } = await params;
  const query = await searchParams;
  await requirePermission("announcement.send", {
    next: `/app/admin/seasons/${slug}/announcements`,
    scope: "league",
  });
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  if (!season) notFound();
  const [teams, past, waiting, games] = await Promise.all([
    teamsToAnnounceTo(db, season.id),
    announcementsOf(db, season.id),
    scheduledAnnouncements(db, season.id),
    publishedSchedule(db, season.id),
  ]);
  const names = new Map(teams.map((t) => [t.id as string, t.name]));
  const teamName = (id: string | null) =>
    id ? (names.get(id) ?? "A team") : "Everyone";
  const tz = season.timeZone;
  const when = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
    }).format(d);
  const now = new Date();
  const next = nextSweep(now);
  const schedule: ScheduleChoice = {
    next: when(next),
    sweepTime: new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
      timeZoneName: "short",
    }).format(next),
    // Days in the league's time zone; the last day is one short of the
    // limit, so its sweep is always within it.
    minDay: localDay(next, tz),
    maxDay: localDay(
      new Date(now.getTime() + (MAX_DAYS_AHEAD - 1) * 86_400_000),
      tz,
    ),
  };
  const scheduleUrl = absoluteUrl(
    siteOrigin(env.BETTER_AUTH_URL),
    `/seasons/${slug}/schedule`,
  );
  const today = localDay(now, tz);
  const gameDays = groupByDay(games, tz)
    .filter((d) => d.day >= today)
    .slice(0, GAME_DAYS_TO_SHARE);
  const error =
    typeof query.error === "string" ? ANNOUNCE_ERRORS[query.error] : undefined;
  const notice =
    announceNotice(query.sent) ??
    (typeof query.notice === "string" ? NOTICES[query.notice] : undefined);

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href={`/app/admin/seasons/${slug}`} className="underline">
          {season.name}
        </Link>
        <h1 className="text-h1">Announcements</h1>
        <p className="text-text-muted">
          Email everyone registered for {season.name}, or one team, now or on a
          day you pick.
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
          schedule={schedule}
        />
      </section>
      <section aria-labelledby="scheduled" className="flex flex-col gap-3">
        <h2 id="scheduled" className="text-h2">
          Scheduled
        </h2>
        {waiting.length === 0 ? (
          <p className="text-text-muted">Nothing waiting to send.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {waiting.map((a) => (
              <Scheduled
                key={a.id}
                item={a}
                slug={slug}
                to={teamName(a.teamSeasonId)}
                sendsAt={when(a.sendAt)}
                sendDay={localDay(a.sendAt, tz)}
                schedule={schedule}
              />
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="sent" className="flex flex-col gap-3">
        <h2 id="sent" className="text-h2">
          Sent
        </h2>
        <AnnouncementList items={past} when={when} teamName={teamName} />
      </section>
      <section aria-labelledby="chat" className="flex flex-col gap-3">
        <h2 id="chat" className="text-h2">
          Game days for the group chat
        </h2>
        {gameDays.length === 0 ? (
          <p className="text-text-muted">
            No upcoming game days on the published schedule.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {gameDays.map((d) => (
              <li
                key={d.day}
                className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4"
              >
                <h3 className="text-h3">{dayHeading(d.day)}</h3>
                <ul className="text-small">
                  {d.games.map((g) => (
                    <li key={g.id}>
                      {g.startsAt ? kickoff(g.startsAt, tz) : "Time TBA"}:{" "}
                      {g.teamA.name} vs {g.teamB.name}
                      {placeLine(g) ? `, ${placeLine(g)}` : ""}
                    </li>
                  ))}
                </ul>
                <CopyForWhatsApp
                  about={`the schedule for ${dayHeading(d.day)}`}
                  text={gameDayShareText({
                    seasonName: season.name,
                    day: d.day,
                    games: d.games,
                    timeZone: tz,
                    url: scheduleUrl,
                  })}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/** A scheduled announcement, with its edit form and a way to cancel it. */
function Scheduled({
  item,
  slug,
  to,
  sendsAt,
  sendDay,
  schedule,
}: {
  item: ScheduledAnnouncement;
  slug: string;
  to: string;
  sendsAt: string;
  /** The day it sends, in the league's time zone. */
  sendDay: string;
  schedule: ScheduleChoice;
}) {
  return (
    <li className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4">
      <p className="font-bold">{item.subject}</p>
      <p className="text-small text-text-muted">
        To {to} · sends {sendsAt}
      </p>
      <p className="whitespace-pre-line">{item.body}</p>
      <CopyForWhatsApp
        about={item.subject}
        text={announcementShareText({ subject: item.subject, body: item.body })}
      />
      <details>
        <summary className="min-h-11 cursor-pointer py-2 underline">
          Edit<span className="sr-only">: {item.subject}</span>
        </summary>
        <form
          action={editScheduledAction.bind(null, slug, item.id)}
          className="flex flex-col gap-3 pt-2"
        >
          <input type="hidden" name="when" value="day" />
          <label className="flex flex-col gap-1">
            Subject
            <input
              name="subject"
              required
              maxLength={SUBJECT_MAX}
              defaultValue={item.subject}
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1">
            Message
            <textarea
              name="body"
              required
              maxLength={BODY_MAX}
              rows={6}
              defaultValue={item.body}
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1">
            Day to send
            <input
              type="date"
              name="day"
              required
              min={schedule.minDay}
              max={schedule.maxDay}
              defaultValue={sendDay}
              className={field}
            />
          </label>
          <SubmitButton className="btn self-start btn-primary">
            Save changes
          </SubmitButton>
        </form>
      </details>
      <form action={cancelScheduledAction.bind(null, slug, item.id)}>
        <SubmitButton className="btn btn-secondary">
          Cancel it<span className="sr-only">: {item.subject}</span>
        </SubmitButton>
      </form>
    </li>
  );
}
