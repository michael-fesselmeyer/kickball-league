"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { recordPayout, setPayRate } from "@/db/queries/referee-pool";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { localDate } from "@/domain/books/ledger-csv";
import { isOneOf } from "@/domain/guards";
import { parseId, type UserId } from "@/domain/ids";
import { PAYOUT_METHODS, parseDollars } from "@/domain/referees/pay";
import { activeLeagueId } from "@/lib/league/active";
import { requirePermissionToChange } from "@/lib/auth/permission";

const pageFor = (slug: string) => `/app/admin/seasons/${slug}/referees/pay`;

async function context(slug: string) {
  const page = pageFor(slug);
  const subject = await requirePermissionToChange("referee.manage", {
    next: page,
  });
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  if (!season) notFound();
  return { page, subject, season };
}

export async function setPayRateAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const { page, subject, season } = await context(slug);
  const feeCents = parseDollars(form.get("fee"));
  if (feeCents === null) redirect(`${page}?error=fee`);
  await txDb.transaction((tx) =>
    setPayRate(tx, { seasonId: season.id, feeCents, actorId: subject.userId }),
  );
  redirect(`${page}?notice=fee`);
}

export async function recordPayoutAction(
  slug: string,
  rawUserId: string,
  form: FormData,
): Promise<void> {
  const { page, subject, season } = await context(slug);
  const userId = parseId<UserId>(rawUserId);
  if (!userId) notFound();
  const amountCents = parseDollars(form.get("amount"));
  const method = form.get("method");
  const paidBefore = Number(form.get("paidBefore"));
  if (amountCents === null || amountCents === 0)
    redirect(`${page}?error=amount#ref-${userId}`);
  if (!isOneOf(PAYOUT_METHODS, method))
    redirect(`${page}?error=method#ref-${userId}`);
  if (!Number.isSafeInteger(paidBefore) || paidBefore < 0)
    redirect(`${page}?error=stale#ref-${userId}`);
  const result = await txDb.transaction((tx) =>
    recordPayout(tx, {
      leagueId: season.leagueId,
      seasonId: season.id,
      userId,
      amountCents,
      method,
      paidOn: localDate(new Date(), season.timeZone),
      paidBeforeCents: paidBefore,
      actorId: subject.userId,
    }),
  );
  if (!result.ok) redirect(`${page}?error=${result.error}#ref-${userId}`);
  redirect(`${page}?notice=paid#ref-${userId}`);
}
