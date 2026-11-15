"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  closePollNow,
  openPoll,
  queueReminders,
  removePoll,
} from "@/db/queries/captain-polls";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { localDate } from "@/domain/books/ledger-csv";
import { parsePollForm } from "@/domain/captain-polls/captain-polls";
import { type CaptainPollId, parseId } from "@/domain/ids";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { formStrings } from "@/lib/form";
import { activeLeagueId } from "@/lib/league/active";
import { requireInLeague } from "@/lib/league/guard";

const pageOf = (slug: string) => `/app/admin/seasons/${slug}/captain-polls`;

async function guard(slug: string) {
  const subject = await requirePermissionToChange("captain_polls.manage", {
    next: pageOf(slug),
  });
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  if (!season) notFound();
  return { subject, season };
}

const OPTION_FIELDS = ["option1", "option2", "option3", "option4", "option5"];

/** Opens a poll; voting starts now and every captain is invited. */
export async function openPollAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const { subject, season } = await guard(slug);
  const values = formStrings(form, [
    "title",
    "detail",
    "voters",
    "results",
    "closesOn",
    "closesTime",
    ...OPTION_FIELDS,
  ] as const);
  const parsed = parsePollForm(
    {
      ...values,
      options: OPTION_FIELDS.map((f) => form.get(f)?.toString() ?? ""),
    },
    { now: new Date(), timeZone: season.timeZone },
  );
  if (!parsed.ok) redirect(`${pageOf(slug)}?error=${parsed.error}`);
  const id = await openPoll(txDb, {
    seasonId: season.id,
    poll: parsed.value,
    actorId: subject.userId,
  });
  redirect(`${pageOf(slug)}?notice=opened&poll=${id}`);
}

async function named(slug: string, rawPollId: string) {
  const ctx = await guard(slug);
  const pollId = parseId<CaptainPollId>(rawPollId);
  if (!pollId) notFound();
  await requireInLeague(ctx.subject, { captain_poll: pollId });
  return { ...ctx, pollId };
}

/** Ends voting now, so every captain sees the totals. */
export async function closePollAction(
  slug: string,
  rawPollId: string,
): Promise<void> {
  const { subject, season, pollId } = await named(slug, rawPollId);
  const result = await closePollNow(txDb, {
    pollId,
    seasonId: season.id,
    actorId: subject.userId,
    now: new Date(),
  });
  if (!result.ok) redirect(`${pageOf(slug)}?error=${result.error}`);
  redirect(`${pageOf(slug)}?notice=closed`);
}

/** Removes a poll, its options and every vote. */
export async function removePollAction(
  slug: string,
  rawPollId: string,
): Promise<void> {
  const { subject, season, pollId } = await named(slug, rawPollId);
  const result = await removePoll(txDb, {
    pollId,
    seasonId: season.id,
    actorId: subject.userId,
  });
  if (!result.ok) redirect(`${pageOf(slug)}?error=${result.error}`);
  redirect(`${pageOf(slug)}?notice=removed`);
}

/** Reminds the teams that haven't voted, at most once a day per captain. */
export async function remindAction(
  slug: string,
  rawPollId: string,
): Promise<void> {
  const { season, pollId, subject } = await named(slug, rawPollId);
  const now = new Date();
  await txDb.transaction((tx) =>
    queueReminders(tx, {
      leagueId: required(subject.leagueId),
      now,
      today: localDate(now, season.timeZone),
      pollId,
    }),
  );
  redirect(`${pageOf(slug)}?notice=reminded`);
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) notFound();
  return value;
}
