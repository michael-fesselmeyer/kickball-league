"use server";

import { notFound, redirect } from "next/navigation";
import { txDb } from "@/db/client";
import { createMaker, removeMaker, updateMaker } from "@/db/queries/shirt-makers";
import { parseId, type ShirtMakerId } from "@/domain/ids";
import { type MakerForm, parseMakerForm } from "@/domain/shirts/makers";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";

const PAGE = "/app/admin/shirt-makers";

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
};

const readForm = (form: FormData): MakerForm => ({
  name: text(form, "name"),
  url: text(form, "url"),
  makes: text(form, "makes"),
  minimumOrder: text(form, "minimumOrder"),
});

async function adminOfLeague() {
  const subject = await requirePermissionToChange("shirts.manage", {
    next: PAGE,
  });
  const league = await activeLeague();
  if (!league) notFound();
  return { subject, league };
}

/** The page's notice codes for a refused form: the message, by code. */
function refuse(error: string): never {
  redirect(`${PAGE}?error=${encodeURIComponent(error)}`);
}

/** An admin adds a maker; captains whose team wears its own shirts see it. */
export async function createMakerAction(form: FormData): Promise<void> {
  const { subject, league } = await adminOfLeague();
  const parsed = parseMakerForm(readForm(form));
  if (!parsed.ok) refuse(parsed.error);
  const made = await txDb.transaction((tx) =>
    createMaker(tx, {
      leagueId: league.id,
      fields: parsed.value,
      actorId: subject.userId,
    }),
  );
  if (!made.ok) refuse(made.error);
  redirect(`${PAGE}?saved=created`);
}

/** An admin changes a maker's details. */
export async function updateMakerAction(
  makerId: string,
  form: FormData,
): Promise<void> {
  const id = parseId<ShirtMakerId>(makerId);
  if (!id) notFound();
  const { subject, league } = await adminOfLeague();
  const parsed = parseMakerForm(readForm(form));
  if (!parsed.ok) refuse(parsed.error);
  const saved = await txDb.transaction((tx) =>
    updateMaker(tx, {
      leagueId: league.id,
      id,
      fields: parsed.value,
      actorId: subject.userId,
    }),
  );
  if (!saved.ok) refuse(saved.error);
  redirect(`${PAGE}?saved=updated`);
}

/** An admin takes a maker out of the directory, after confirming. */
export async function removeMakerAction(
  makerId: string,
  form: FormData,
): Promise<void> {
  const id = parseId<ShirtMakerId>(makerId);
  if (!id) notFound();
  const { subject, league } = await adminOfLeague();
  if (form.get("confirm") !== "yes") refuse("confirm");
  const removed = await txDb.transaction((tx) =>
    removeMaker(tx, { leagueId: league.id, id, actorId: subject.userId }),
  );
  // Removed in another tab already: the list is right either way.
  if (!removed.ok) refuse("not_found");
  redirect(`${PAGE}?saved=removed`);
}
