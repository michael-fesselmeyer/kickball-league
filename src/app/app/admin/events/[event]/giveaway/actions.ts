"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { eventBySlug } from "@/db/queries/events";
import {
  createGiveaway,
  drawGiveaway,
  giveawayForEvent,
  redrawWinner,
  updateGiveaway,
} from "@/db/queries/giveaways";
import {
  eventCanHoldGiveaway,
  GIVEAWAY_FORM_ERRORS,
  type GiveawayForm,
  HOLD_ERRORS,
  parseGiveawayForm,
  parseRedrawReason,
} from "@/domain/drive/giveaway";
import { isTicketed } from "@/domain/events/tickets";
import { type GiveawayWinnerId, parseId } from "@/domain/ids";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { formStrings } from "@/lib/form";
import { sendQueuedSoon } from "@/services/outbox";

export type GiveawayFormState = { values: GiveawayForm; error: string | null };

const FIELDS = [
  "prize",
  "donatedBy",
  "winnerCount",
  "opensOn",
  "opensTime",
  "closesOn",
  "closesTime",
  "officialRules",
] as const;

const pageOf = (slug: string) => `/app/admin/events/${slug}/giveaway`;

/** An admin adds a giveaway to an event, or changes it before the draw. */
export async function saveGiveawayAction(
  slug: string,
  _previous: GiveawayFormState,
  form: FormData,
): Promise<GiveawayFormState> {
  const page = pageOf(slug);
  const subject = await requirePermissionToChange("giveaway.manage", {
    next: page,
  });
  const e = await eventBySlug(db, slug, "all");
  if (!e) notFound();
  const values = formStrings(form, FIELDS);
  const fail = (error: string) => ({ values, error });
  const holds = eventCanHoldGiveaway({ kind: e.kind, ticketed: isTicketed(e) });
  if (!holds.ok) return fail(HOLD_ERRORS[holds.error]);
  const parsed = parseGiveawayForm(values, e.timeZone);
  if (!parsed.ok) return fail(GIVEAWAY_FORM_ERRORS[parsed.error]);
  const existing = await giveawayForEvent(db, e.id);
  const saved = await txDb.transaction(async (tx) => {
    if (!existing) {
      const created = await createGiveaway(tx, {
        eventId: e.id,
        giveaway: parsed.value,
        actorId: subject.userId,
      });
      return created.ok ? null : created.error;
    }
    const updated = await updateGiveaway(tx, {
      id: existing.id,
      giveaway: parsed.value,
      actorId: subject.userId,
    });
    return updated.ok ? null : updated.error;
  });
  if (saved !== null)
    return fail(
      saved === "drawn"
        ? "The winners are drawn, so the giveaway can't change now."
        : "Someone else just changed this giveaway. Reload to see it.",
    );
  redirect(`${page}?saved=${existing ? "updated" : "created"}`);
}

/** Draws the winners once entry has closed. */
export async function drawAction(slug: string, form: FormData): Promise<void> {
  const page = pageOf(slug);
  const subject = await requirePermissionToChange("giveaway.manage", {
    next: page,
  });
  if (form.get("confirm") !== "yes") redirect(`${page}?error=confirm`);
  const e = await eventBySlug(db, slug, "all");
  const g = e ? await giveawayForEvent(db, e.id) : null;
  if (!g) notFound();
  const drawn = await txDb.transaction((tx) =>
    drawGiveaway(tx, {
      giveawayId: g.id,
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  if (!drawn.ok) redirect(`${page}?error=${drawn.error}`);
  sendQueuedSoon();
  redirect(`${page}?saved=drawn#winners`);
}

/** Replaces one winner, with a reason that goes into the audit log. */
export async function redrawAction(
  slug: string,
  rawWinnerId: string,
  form: FormData,
): Promise<void> {
  const page = pageOf(slug);
  const subject = await requirePermissionToChange("giveaway.manage", {
    next: page,
  });
  const winnerId = parseId<GiveawayWinnerId>(rawWinnerId);
  const e = await eventBySlug(db, slug, "all");
  const g = e ? await giveawayForEvent(db, e.id) : null;
  if (!g || !winnerId) notFound();
  const raw = form.get("reason");
  const reason = parseRedrawReason(typeof raw === "string" ? raw : "");
  if (!reason.ok) redirect(`${page}?error=reason#winners`);
  const redrawn = await txDb.transaction((tx) =>
    redrawWinner(tx, {
      giveawayId: g.id,
      winnerId,
      reason: reason.value,
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  if (!redrawn.ok) redirect(`${page}?error=${redrawn.error}#winners`);
  sendQueuedSoon();
  redirect(`${page}?saved=redrawn#winners`);
}
