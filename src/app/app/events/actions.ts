"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { eventBySlug, joinEvent, leaveEvent } from "@/db/queries/events";
import { requirePermission } from "@/lib/auth/permission";
import { refreshEventPages } from "@/lib/public-cache";

async function eventFor(slug: string) {
  const page = `/app/events/${slug}`;
  const subject = await requirePermission("event.rsvp", { next: page });
  const e = await eventBySlug(db, slug);
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
  refreshEventPages(e.slug);
  redirect(`${page}?done=left`);
}
