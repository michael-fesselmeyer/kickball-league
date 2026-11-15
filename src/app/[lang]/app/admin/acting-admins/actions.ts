"use server";

import { notFound, redirect } from "next/navigation";
import { txDb } from "@/db/client";
import {
  endActingAdmin,
  grantActingAdmin,
  queueActingAdminNotices,
} from "@/db/queries/acting-admin";
import { type ActingAdminId, parseId, type UserId } from "@/domain/ids";
import { addDays } from "@/domain/season/rollover";
import { zonedInstant } from "@/domain/time/zoned";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { formStrings } from "@/lib/form";
import { activeLeague } from "@/lib/league/active";
import { sendQueuedSoon } from "@/services/outbox";

const PAGE = "/app/admin/acting-admins";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Names a player acting admin from the start of one day through the end of
 * another, in the league's time zone, with the powers ticked (admins.manage:
 * owners only). The acting admin and the owners are told at once when it
 * starts now, and otherwise when the day comes.
 */
export async function grantAction(form: FormData): Promise<void> {
  const subject = await requirePermissionToChange("admins.manage", {
    next: PAGE,
  });
  const league = await activeLeague();
  if (!league) notFound();
  const { player, from, through } = formStrings(form, [
    "player",
    "from",
    "through",
  ] as const);
  const userId = parseId<UserId>(player);
  if (!userId) redirect(`${PAGE}?error=not_a_player`);
  if (!DATE.test(from) || !DATE.test(through))
    redirect(`${PAGE}?error=bad_dates`);
  const now = new Date();
  const result = await txDb.transaction(async (tx) => {
    const granted = await grantActingAdmin(tx, {
      leagueId: league.id,
      userId,
      powers: form.getAll("powers").filter((p) => typeof p === "string"),
      startsAt: zonedInstant(from, "00:00", league.timeZone),
      // "Through" is inclusive: it ends as that day ends.
      endsAt: zonedInstant(addDays(through, 1), "00:00", league.timeZone),
      actorId: subject.userId,
      now,
    });
    if (granted.ok) await queueActingAdminNotices(tx, now);
    return granted;
  });
  if (!result.ok) redirect(`${PAGE}?error=${result.error}`);
  sendQueuedSoon();
  redirect(`${PAGE}?notice=granted`);
}

/** Ends a handover now; the acting admin and the owners are told. */
export async function endAction(rawId: string): Promise<void> {
  const subject = await requirePermissionToChange("admins.manage", {
    next: PAGE,
  });
  const league = await activeLeague();
  const id = parseId<ActingAdminId>(rawId);
  if (!league || !id) notFound();
  const now = new Date();
  const result = await txDb.transaction(async (tx) => {
    const ended = await endActingAdmin(tx, {
      id,
      leagueId: league.id,
      actorId: subject.userId,
      now,
    });
    if (ended.ok) await queueActingAdminNotices(tx, now);
    return ended;
  });
  if (!result.ok) redirect(`${PAGE}?error=${result.error}`);
  sendQueuedSoon();
  redirect(`${PAGE}?notice=ended`);
}
