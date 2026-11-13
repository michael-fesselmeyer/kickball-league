"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  createFriendLeague,
  type FriendSaveError,
  removeFriendLeague,
  removeFriendLogo,
  setFriendLogo,
  type StoredLogo,
  updateFriendLeague,
} from "@/db/queries/friends";
import type { Db } from "@/db/queries/schedule";
import { currentLeague } from "@/db/queries/seasons";
import {
  FRIEND_FORM_ERRORS,
  type FriendForm,
  parseFriendForm,
} from "@/domain/friends/friend-form";
import {
  checkLogoUpload,
  LOGO_ERRORS,
  type LogoError,
} from "@/domain/friends/logo";
import { type FriendLeagueId, parseId } from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { compressLogo } from "@/lib/friends/compress-logo";
import { refreshFriendPages } from "@/lib/public-cache";

export type FriendFormState = { values: FriendForm; error: string | null };

const LIST = "/app/admin/friends";

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
};

function formValues(form: FormData): FriendForm {
  return {
    name: text(form, "name"),
    activity: text(form, "activity"),
    area: text(form, "area"),
    description: text(form, "description"),
    url: text(form, "url"),
    linksBack: form.get("linksBack") === "yes",
  };
}

async function adminOfLeague(next: string) {
  const subject = await requirePermissionToChange("friends.manage", { next });
  const league = await currentLeague(db);
  if (!league) notFound();
  return { subject, league };
}

/** The uploaded logo's stored copy; null when the form has no file. */
async function readLogo(
  form: FormData,
): Promise<Result<StoredLogo | null, LogoError>> {
  const file = form.get("logo");
  if (!(file instanceof File) || file.size === 0) return ok(null);
  const checked = checkLogoUpload(file);
  if (!checked.ok) return checked;
  const stored = await compressLogo(Buffer.from(await file.arrayBuffer()));
  return stored ? ok(stored) : err("logo_unreadable");
}

const SAVE_ERRORS: Record<FriendSaveError, string> = {
  name_taken: "A league with that name is already in the directory.",
  not_found: "That league is no longer in the directory.",
};

type SaveError = FriendSaveError | LogoError;

const MESSAGES: Record<SaveError, string> = { ...SAVE_ERRORS, ...LOGO_ERRORS };
const message = (error: SaveError) => MESSAGES[error];

/**
 * Saves the entry and its new logo together: if the logo doesn't fit, the
 * entry isn't saved either, so the admin can fix the form and try again.
 */
async function save(
  write: (tx: Db) => Promise<Result<FriendLeagueId, SaveError>>,
): Promise<Result<FriendLeagueId, SaveError>> {
  let failed: SaveError | null = null;
  try {
    return await txDb.transaction(async (tx) => {
      const result = await write(tx);
      if (!result.ok) {
        failed = result.error;
        // Undo the entry's change; Drizzle throws to do it.
        tx.rollback();
      }
      return result;
    });
  } catch (e) {
    if (failed) return err(failed);
    throw e;
  }
}

/** An admin adds a league to the directory; it shows on /friends at once. */
export async function createFriendAction(
  _previous: FriendFormState,
  form: FormData,
): Promise<FriendFormState> {
  const { subject, league } = await adminOfLeague(`${LIST}/new`);
  const values = formValues(form);
  const parsed = parseFriendForm(values);
  if (!parsed.ok) return { values, error: FRIEND_FORM_ERRORS[parsed.error] };
  const logo = await readLogo(form);
  if (!logo.ok) return { values, error: LOGO_ERRORS[logo.error] };
  const saved = await save(async (tx) => {
    const created = await createFriendLeague(tx, {
      leagueId: league.id,
      fields: parsed.value,
      actorId: subject.userId,
    });
    if (!created.ok || !logo.value) return created;
    const set = await setFriendLogo(tx, {
      leagueId: league.id,
      id: created.value,
      logo: logo.value,
      actorId: subject.userId,
    });
    return set.ok ? created : set;
  });
  if (!saved.ok) return { values, error: message(saved.error) };
  refreshFriendPages();
  redirect(`${LIST}?saved=created`);
}

/** An admin changes an entry, and its logo when a new file is chosen. */
export async function updateFriendAction(
  friendId: string,
  _previous: FriendFormState,
  form: FormData,
): Promise<FriendFormState> {
  const id = parseId<FriendLeagueId>(friendId);
  if (!id) notFound();
  const { subject, league } = await adminOfLeague(`${LIST}/${id}`);
  const values = formValues(form);
  const parsed = parseFriendForm(values);
  if (!parsed.ok) return { values, error: FRIEND_FORM_ERRORS[parsed.error] };
  const logo = await readLogo(form);
  if (!logo.ok) return { values, error: LOGO_ERRORS[logo.error] };
  const saved = await save(async (tx) => {
    const updated = await updateFriendLeague(tx, {
      leagueId: league.id,
      id,
      fields: parsed.value,
      actorId: subject.userId,
    });
    if (!updated.ok) return updated;
    if (!logo.value) return ok(id);
    const set = await setFriendLogo(tx, {
      leagueId: league.id,
      id,
      logo: logo.value,
      actorId: subject.userId,
    });
    return set.ok ? ok(id) : set;
  });
  if (!saved.ok) return { values, error: message(saved.error) };
  refreshFriendPages();
  redirect(`${LIST}?saved=updated`);
}

/** Takes an entry's logo down; the entry stays. */
export async function removeFriendLogoAction(friendId: string): Promise<void> {
  const id = parseId<FriendLeagueId>(friendId);
  if (!id) notFound();
  const page = `${LIST}/${id}`;
  const { subject, league } = await adminOfLeague(page);
  await txDb.transaction((tx) =>
    removeFriendLogo(tx, { leagueId: league.id, id, actorId: subject.userId }),
  );
  refreshFriendPages();
  redirect(`${page}?saved=logo_removed`);
}

/** Takes a league out of the directory, after the admin confirms. */
export async function removeFriendAction(
  friendId: string,
  form: FormData,
): Promise<void> {
  const id = parseId<FriendLeagueId>(friendId);
  if (!id) notFound();
  const page = `${LIST}/${id}`;
  const { subject, league } = await adminOfLeague(page);
  if (form.get("confirm") !== "yes") redirect(`${page}?error=confirm`);
  const removed = await txDb.transaction((tx) =>
    removeFriendLeague(tx, {
      leagueId: league.id,
      id,
      actorId: subject.userId,
    }),
  );
  if (!removed.ok) notFound();
  refreshFriendPages();
  redirect(`${LIST}?saved=removed`);
}
