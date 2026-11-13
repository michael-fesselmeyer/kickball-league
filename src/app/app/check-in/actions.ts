"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { currentLeague } from "@/db/queries/seasons";
import { checkIn, redeemDeal, sponsorForCheckIn } from "@/db/queries/sponsors";
import { type DealId, parseId } from "@/domain/ids";
import { localDay } from "@/domain/schedule/public-game";
import { isCurrentCheckinCode } from "@/domain/sponsors/checkin-code";
import { localTime } from "@/domain/time/zoned";
import { requirePermissionToChange } from "@/lib/auth/permission";

const visitPage = (slug: string) => `/app/check-in/${slug}`;

async function leagueClock(now: Date) {
  const league = await currentLeague(db);
  const timeZone = league?.timeZone ?? "America/New_York";
  return { day: localDay(now, timeZone), time: localTime(now, timeZone) };
}

/**
 * Checks the player in, if the code they scanned is still current. The
 * code is checked again here, not only when the page showed the button.
 */
export async function checkInAction(slug: string, code: string): Promise<void> {
  const page = `${visitPage(slug)}/${code}`;
  const subject = await requirePermissionToChange("sponsor.check_in", {
    next: page,
  });
  const sponsor = await sponsorForCheckIn(db, slug);
  if (!sponsor) notFound();
  const now = new Date();
  if (!isCurrentCheckinCode(sponsor.secret, sponsor.id, code, now))
    redirect(`${page}?error=expired`);
  const { day } = await leagueClock(now);
  const { first } = await txDb.transaction((tx) =>
    checkIn(tx, {
      sponsorId: sponsor.id,
      userId: subject.userId,
      onDate: day,
      now,
    }),
  );
  redirect(`${visitPage(slug)}?notice=${first ? "checked_in" : "already"}`);
}

/** Uses one of the day's deals on today's check-in. */
export async function redeemDealAction(
  slug: string,
  rawDealId: string,
): Promise<void> {
  const page = visitPage(slug);
  const subject = await requirePermissionToChange("sponsor.check_in", {
    next: page,
  });
  const sponsor = await sponsorForCheckIn(db, slug);
  const dealId = parseId<DealId>(rawDealId);
  if (!sponsor || !dealId) notFound();
  const now = new Date();
  const { day, time } = await leagueClock(now);
  const result = await txDb.transaction((tx) =>
    redeemDeal(tx, {
      sponsorId: sponsor.id,
      dealId,
      userId: subject.userId,
      onDate: day,
      time,
      now,
    }),
  );
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  redirect(`${page}?notice=used#deal-${dealId}`);
}
