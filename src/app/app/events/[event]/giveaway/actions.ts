"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { viewerOf, visibleEvent } from "@/db/queries/event-audience";
import {
  enterGiveaway,
  giveawayCodeSecret,
  giveawayForEvent,
  hasEntered,
} from "@/db/queries/giveaways";
import { can } from "@/domain/authz/permissions";
import { mayEnter } from "@/domain/drive/giveaway";
import { isTicketed } from "@/domain/events/tickets";
import { isCurrentCheckinCode } from "@/domain/sponsors/checkin-code";
import { requirePermissionToChange } from "@/lib/auth/permission";

/**
 * Enters the player, if the code they scanned at the event is still
 * current. The code and the rules are checked again here, not only when
 * the page showed the button. Nothing about a payment is asked or read.
 */
export async function enterGiveawayAction(
  slug: string,
  code: string,
): Promise<void> {
  const giveawayPage = `/app/events/${slug}/giveaway`;
  const page = `${giveawayPage}/enter/${code}`;
  const subject = await requirePermissionToChange("giveaway.enter", {
    next: page,
  });
  const staff = can(subject, "event.manage");
  const e = await visibleEvent(db, slug, subject.userId, staff);
  const [g, secret] = e
    ? await Promise.all([
        giveawayForEvent(db, e.id),
        giveawayCodeSecret(db, e.id),
      ])
    : [null, null];
  if (!e || !g || !secret) notFound();
  const now = new Date();
  if (!isCurrentCheckinCode(secret.secret, g.id, code, now))
    redirect(`${page}?error=expired`);
  const [viewer, entered] = await Promise.all([
    viewerOf(db, e.leagueId, subject.userId, staff),
    hasEntered(db, g.id, subject.userId),
  ]);
  const allowed = mayEnter({
    audience: e.audience,
    viewer,
    giveaway: g,
    eventCancelled: e.cancelledAt !== null,
    eventTicketed: isTicketed(e),
    alreadyEntered: entered,
    now,
  });
  if (!allowed.ok)
    redirect(
      allowed.error === "already_entered"
        ? `${giveawayPage}?notice=already`
        : `${giveawayPage}?error=${allowed.error}`,
    );
  const result = await txDb.transaction((tx) =>
    enterGiveaway(tx, { giveawayId: g.id, userId: subject.userId, now }),
  );
  if (!result.ok) redirect(`${giveawayPage}?error=closed`);
  redirect(
    `${giveawayPage}?notice=${result.value.first ? "entered" : "already"}`,
  );
}
