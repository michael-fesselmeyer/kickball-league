"use server";

import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { recordAudit } from "@/db/queries/audit";
import {
  adminsConfirmRainouts,
  anySlotOpen,
  cancelOpenSlots,
  gameDayParks,
  sendRainoutToOwners,
  setAdminsConfirmRainouts,
  worstPark,
} from "@/db/queries/rainout-decision";
import { loadVersion, saveVersion } from "@/db/queries/schedule";
import { seasonBySlug, versionsOf } from "@/db/queries/schedule-screen";
import { user } from "@/db/schema/auth";
import type { SlotId } from "@/domain/ids";
import { reschedule } from "@/domain/scheduler/reschedule";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { parkDecision, parkWeather } from "@/lib/park-weather";
import { featureEnabled } from "@/lib/platform/site";
import { refreshSeasonPages } from "@/lib/public-cache";
import { activeLeague } from "@/lib/league/active";
import { dayLabel } from "./words";

const pageOf = (slug: string) => `/app/admin/seasons/${slug}/rainout`;

/**
 * The league the app is showing (ADR 0048), and whether its owners let
 * admins confirm, for the permission check.
 */
async function confirmContext() {
  const league = await activeLeague();
  return {
    league,
    adminsConfirmRainouts: league
      ? await adminsConfirmRainouts(db, league.id)
      : false,
  };
}

/**
 * Confirms a rain-out for a whole date: cancels its slots and saves a draft
 * version with the postponed games placed as makeups, in one transaction.
 * The owners and the operator confirm, and admins when the owners allow it
 * (ADR 0048). The draft is reviewed and published on the schedule screen.
 */
export async function declareRainout(
  slug: string,
  date: string,
): Promise<void> {
  const page = pageOf(slug);
  const { league, adminsConfirmRainouts } = await confirmContext();
  const subject = await requirePermissionToChange("rainout.confirm", {
    next: page,
    adminsConfirmRainouts,
  });
  const season = await seasonBySlug(db, league?.id ?? null, slug);
  if (!season) notFound();
  const published = (await versionsOf(db, season.id)).find(
    (v) => v.status === "published",
  );
  const version = published ? await loadVersion(db, published.id) : null;
  if (!version) redirect(`${page}?error=no_published`);

  const cancelled = version.input.slots
    .filter((s) => s.date === date)
    .map((s) => s.id);
  if (cancelled.length === 0) redirect(`${page}?error=no_games`);
  const result = reschedule(version.input, version.schedule, cancelled);

  const draftId = await txDb.transaction(async (tx) => {
    // Someone else confirmed this day first: nothing more to cancel.
    if ((await cancelOpenSlots(tx, cancelled as SlotId[])).length === 0)
      return null;
    const id = await saveVersion(tx, {
      seasonId: version.seasonId,
      // Cancelled slots are gone: they are neither reserve nor places to move to.
      input: {
        ...version.input,
        slots: version.input.slots.filter((s) => !cancelled.includes(s.id)),
        locked: result.locked,
      },
      schedule: result.schedule,
      origin: "rainout",
      parentVersionId: version.id,
      createdBy: subject.userId,
    });
    await recordAudit(tx, {
      actorId: subject.userId,
      action: "rainout.declare",
      entityType: "season",
      entityId: version.seasonId,
      after: {
        date,
        slotsCancelled: cancelled.length,
        postponed: result.moved.length,
        unplaced: result.moved.filter((m) => m.to === null).length,
        draftVersionId: id,
      },
    });
    return id;
  });
  if (draftId === null) redirect(`${page}?date=${date}&error=already`);
  // The cancelled slots show as called off on the public pages at once.
  refreshSeasonPages(season.id);
  redirect(`/app/admin/seasons/${slug}/schedule?rainout=${draftId}`);
}

/**
 * An admin sends a date's rain-out to the owners to confirm (ADR 0048):
 * each owner gets an urgent message with the decision card's summary and a
 * link back to this screen. Nothing is cancelled.
 */
export async function sendRainoutAction(
  slug: string,
  date: string,
): Promise<void> {
  const page = pageOf(slug);
  const subject = await requirePermissionToChange("rainout.prepare", {
    next: page,
  });
  const league = await activeLeague();
  const season = league ? await seasonBySlug(db, league.id, slug) : null;
  if (!season || !league) notFound();
  const published = (await versionsOf(db, season.id)).find(
    (v) => v.status === "published",
  );
  const version = published ? await loadVersion(db, published.id) : null;
  if (!version) redirect(`${page}?error=no_published`);
  const daySlots = version.input.slots
    .filter((s) => s.date === date)
    .map((s) => s.id as SlotId);
  if (daySlots.length === 0) redirect(`${page}?error=no_games`);
  if (!(await anySlotOpen(db, daySlots)))
    redirect(`${page}?date=${date}&error=already`);

  // The card's sentence goes along when the weather can be read; read
  // before the transaction, so a slow forecast never holds one open.
  let summary: string | null = null;
  if (await featureEnabled("weather")) {
    const now = new Date();
    const parks = await gameDayParks(db, season.id, date, season.timeZone);
    const worst = worstPark(
      await Promise.all(
        parks.map(async (p) => ({
          park: p.venue,
          decision: parkDecision(
            await parkWeather(db, p.lat, p.lng, now),
            p.games,
            now,
            season.timeZone,
          ),
        })),
      ),
    );
    if (worst && !worst.decision.blind)
      summary =
        parks.length > 1
          ? `${worst.park}: ${worst.decision.summary}`
          : worst.decision.summary;
  }
  const [me] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, subject.userId));

  await txDb.transaction((tx) =>
    sendRainoutToOwners(tx, {
      leagueId: league.id,
      season: { id: season.id, slug, name: season.name },
      date,
      day: dayLabel(date),
      actorId: subject.userId,
      actorName: me?.name || "An admin",
      summary,
      now: new Date(),
    }),
  );
  redirect(`${page}?date=${date}&notice=sent#decision`);
}

/** The owners let admins confirm rain-outs too, or take that back. */
export async function setRainoutPolicyAction(
  slug: string,
  date: string | null,
  form: FormData,
): Promise<void> {
  const page = pageOf(slug);
  const subject = await requirePermissionToChange("rainout.confirm_policy", {
    next: page,
  });
  const league = await activeLeague();
  if (!league) notFound();
  const on = form.get("adminsConfirm") === "on";
  await txDb.transaction((tx) =>
    setAdminsConfirmRainouts(tx, {
      leagueId: league.id,
      actorId: subject.userId,
      on,
    }),
  );
  // Bound arguments come back from the browser: keep only a real date.
  const query = new URLSearchParams({
    ...(date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { date } : {}),
    notice: on ? "admins_confirm" : "owners_confirm",
  });
  redirect(`${page}?${query.toString()}#who-confirms`);
}
