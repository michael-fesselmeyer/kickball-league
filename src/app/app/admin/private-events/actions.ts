"use server";
import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  acceptPrivateEvent,
  declinePrivateEvent,
} from "@/db/queries/private-events";
import { currentLeague } from "@/db/queries/seasons";
import { type PrivateEventId, parseId } from "@/domain/ids";
import { parseAcceptance } from "@/domain/private-events/request";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { sendQueuedSoon } from "@/services/outbox";

const PAGE = "/app/admin/private-events";

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : undefined;
};

async function setup(id: string) {
  const subject = await requirePermissionToChange("private_event.manage", {
    next: PAGE,
  });
  const league = await currentLeague(db);
  const eventId = parseId<PrivateEventId>(id);
  if (!league || !eventId) notFound();
  return { subject, league, eventId };
}

/** Accepts a request as an invite-only private season and tells the organizer. */
export async function acceptPrivateEventAction(
  id: string,
  form: FormData,
): Promise<void> {
  const { subject, league, eventId } = await setup(id);
  const acceptance = parseAcceptance({
    name: text(form, "name"),
    startsOn: text(form, "startsOn"),
    endsOn: text(form, "endsOn"),
    payer: text(form, "payer"),
    amount: text(form, "amount"),
    gamesPerTeamPerDay: text(form, "gamesPerTeamPerDay"),
  });
  if (!acceptance.ok)
    redirect(`${PAGE}?error=${acceptance.error}&request=${id}#request-${id}`);
  const result = await txDb.transaction((tx) =>
    acceptPrivateEvent(tx, {
      leagueId: league.id,
      eventId,
      actorId: subject.userId,
      acceptance: acceptance.value,
      now: new Date(),
    }),
  );
  if (!result.ok) redirect(`${PAGE}?error=${result.error}`);
  sendQueuedSoon();
  redirect(`/app/private-events/${result.value.seasonSlug}?accepted=1`);
}

/** Declines a request, with an optional reason the organizer reads. */
export async function declinePrivateEventAction(
  id: string,
  form: FormData,
): Promise<void> {
  const { subject, league, eventId } = await setup(id);
  const reason = (text(form, "reason") ?? "").trim().slice(0, 500);
  const result = await txDb.transaction((tx) =>
    declinePrivateEvent(tx, {
      leagueId: league.id,
      eventId,
      actorId: subject.userId,
      reason: reason || null,
      now: new Date(),
    }),
  );
  if (!result.ok) redirect(`${PAGE}?error=${result.error}`);
  sendQueuedSoon();
  redirect(`${PAGE}?done=declined`);
}
