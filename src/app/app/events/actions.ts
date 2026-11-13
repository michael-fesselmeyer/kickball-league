"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { resetFeed, visibleEvent } from "@/db/queries/event-audience";
import { joinEvent, leaveEvent } from "@/db/queries/events";
import { can } from "@/domain/authz/permissions";
import {
  requirePermissionToChange,
  requireSelfToChange,
} from "@/lib/auth/permission";
import { refreshEventPages } from "@/lib/public-cache";
import { sendQueuedSoon } from "@/services/outbox";

async function eventFor(slug: string) {
  const page = `/app/events/${slug}`;
  const subject = await requirePermissionToChange("event.rsvp", { next: page });
  // Only an event that is for this person, so a team event's slug is no key.
  const e = await visibleEvent(
    db,
    slug,
    subject.userId,
    can(subject, "event.manage", {}),
  );
  if (!e) notFound();
  return { page, subject, e };
}

/** RSVPs the signed-in player: a spot if there is one, else the waitlist. */
export async function joinEventAction(slug: string): Promise<void> {
  const { page, subject, e } = await eventFor(slug);
  const result = await txDb.transaction((tx) =>
    joinEvent(tx, { eventId: e.id, userId: subject.userId, now: new Date() }),
  );
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  refreshEventPages(e.slug);
  redirect(`${page}?done=${result.value.status}`);
}

/** Drops the signed-in player's RSVP; a freed spot goes to the waitlist. */
export async function leaveEventAction(slug: string): Promise<void> {
  const { page, subject, e } = await eventFor(slug);
  const result = await txDb.transaction((tx) =>
    leaveEvent(tx, { eventId: e.id, userId: subject.userId, now: new Date() }),
  );
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  if (result.value.promoted.length) sendQueuedSoon();
  refreshEventPages(e.slug);
  redirect(`${page}?done=left`);
}

/** A new private calendar link; the old one stops working at once. */
export async function resetFeedAction(): Promise<void> {
  const subject = await requireSelfToChange("profile.edit", "/app/events");
  await resetFeed(db, subject.userId);
  redirect("/app/events?feed=reset#feed");
}
