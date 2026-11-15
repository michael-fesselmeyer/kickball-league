"use server";

import { redirect } from "next/navigation";
import { txDb } from "@/db/client";
import {
  addRecurringCost,
  archiveRecurringCost,
} from "@/db/queries/books-upkeep";
import { parseRecurringForm } from "@/domain/books/forms";
import { parseId, type RecurringCostId } from "@/domain/ids";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { booksSeason, text } from "../../load";

const pageFor = (slug: string) => `/app/books/${slug}/expected`;

function back(slug: string, query: Record<string, string>): never {
  redirect(`${pageFor(slug)}?${new URLSearchParams(query).toString()}#costs`);
}

export async function addRecurringAction(slug: string, form: FormData) {
  const subject = await requirePermissionToChange("books.manage", {
    next: pageFor(slug),
  });
  const { league } = await booksSeason(slug);
  const parsed = parseRecurringForm({
    label: text(form, "label"),
    amount: text(form, "amount"),
    category: text(form, "category"),
    cadence: text(form, "cadence"),
    startsOn: text(form, "startsOn"),
  });
  if (!parsed.ok) back(slug, { error: parsed.error });
  await txDb.transaction((tx) =>
    addRecurringCost(
      tx,
      { leagueId: league.id, ...parsed.value },
      subject.userId,
    ),
  );
  back(slug, { notice: "added" });
}

export async function removeRecurringAction(slug: string, form: FormData) {
  const subject = await requirePermissionToChange("books.manage", {
    next: pageFor(slug),
  });
  const { league } = await booksSeason(slug);
  const costId = parseId<RecurringCostId>(text(form, "costId"));
  if (!costId) back(slug, { error: "unknown_cost" });
  const result = await txDb.transaction((tx) =>
    archiveRecurringCost(
      tx,
      { leagueId: league.id, costId },
      subject.userId,
      new Date(),
    ),
  );
  if (!result.ok) back(slug, { error: result.error });
  back(slug, { notice: "removed" });
}
