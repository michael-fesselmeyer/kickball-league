"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import {
  addOrderToBooks,
  placeShirtOrder,
  receiveShirtOrder,
  remindMissingSizes,
  setSeasonSizes,
} from "@/db/queries/shirt-order";
import { localDate } from "@/domain/scheduler/slots";
import { parseOrderForm, parseSeasonSizes } from "@/domain/shirts/order";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { sendQueuedSoon } from "@/services/outbox";
import { activeLeagueId } from "@/lib/league/active";

const pageFor = (slug: string) => `/app/admin/seasons/${slug}/shirt-order`;

async function adminFor(slug: string) {
  const page = pageFor(slug);
  const subject = await requirePermissionToChange("shirts.manage", {
    next: page,
  });
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  if (!season) notFound();
  return { page, subject, season };
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

/** Changes the sizes players pick from this season (shirts.manage). */
export async function setSizesAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const { page, subject, season } = await adminFor(slug);
  const sizes = parseSeasonSizes(form.getAll("size"));
  if (!sizes.ok) redirect(`${page}?error=no_sizes#sizes`);
  const result = await txDb.transaction((tx) =>
    setSeasonSizes(tx, {
      seasonId: season.id,
      sizes: sizes.value,
      actorId: subject.userId,
    }),
  );
  if (!result.ok) redirect(`${page}?error=${result.error}#sizes`);
  redirect(`${page}?saved=sizes#sizes`);
}

/**
 * Marks the order placed, with its cost and vendor (shirts.manage), or
 * corrects them while it is placed.
 */
export async function placeOrderAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const { page, subject, season } = await adminFor(slug);
  const parsed = parseOrderForm({
    cost: text(form, "cost"),
    vendor: text(form, "vendor"),
  });
  if (!parsed.ok) redirect(`${page}?error=${parsed.error}#order`);
  const result = await txDb.transaction((tx) =>
    placeShirtOrder(tx, {
      seasonId: season.id,
      ...parsed.value,
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  if (!result.ok) redirect(`${page}?error=${result.error}#order`);
  redirect(`${page}?saved=placed#order`);
}

/** The shirts arrived (shirts.manage). */
export async function receiveOrderAction(slug: string): Promise<void> {
  const { page, subject, season } = await adminFor(slug);
  const result = await txDb.transaction((tx) =>
    receiveShirtOrder(tx, {
      seasonId: season.id,
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  if (!result.ok) redirect(`${page}?error=${result.error}#order`);
  redirect(`${page}?saved=received#order`);
}

/**
 * Adds the order's cost to the owners' books as a "shirts" expense, once
 * (books.manage: owners).
 */
export async function addToBooksAction(slug: string): Promise<void> {
  const page = pageFor(slug);
  const subject = await requirePermissionToChange("books.manage", {
    next: page,
  });
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  if (!season) notFound();
  const result = await txDb.transaction((tx) =>
    addOrderToBooks(tx, {
      leagueId: season.leagueId,
      seasonId: season.id,
      spentOn: (placedAt) => localDate(placedAt, season.timeZone),
      actorId: subject.userId,
    }),
  );
  if (!result.ok) redirect(`${page}?error=${result.error}#order`);
  redirect(`${page}?saved=books#order`);
}

/**
 * Asks every registered player without a size the season offers to pick
 * one, each once ever (shirts.manage).
 */
export async function remindSizesAction(slug: string): Promise<void> {
  const { page, subject, season } = await adminFor(slug);
  const asked = await txDb.transaction((tx) =>
    remindMissingSizes(tx, {
      seasonId: season.id,
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  if (asked > 0) sendQueuedSoon();
  redirect(`${page}?reminded=${asked}#missing`);
}
