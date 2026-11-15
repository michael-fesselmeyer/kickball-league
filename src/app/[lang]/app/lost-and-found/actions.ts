"use server";

import { notFound, redirect } from "next/navigation";
import { txDb } from "@/db/client";
import {
  answerItem,
  BOARD_PATH,
  closeOwnPost,
  handOver,
  postItem,
  removeItem,
  withdrawClaim,
  writeMessage,
} from "@/db/queries/lost-found";
import {
  type LostFoundClaimId,
  type LostFoundItemId,
  parseId,
} from "@/domain/ids";
import {
  cleanPost,
  ELSEWHERE,
  type ItemKind,
  POST_MESSAGES,
} from "@/domain/lost-found/rules";
import { UPLOAD_MESSAGES } from "@/domain/member-photos/limits";
import { activeLeague } from "@/lib/league/active";
import { withThumbnail } from "@/lib/lost-found/thumbnail";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { processPhoto } from "@/lib/member-photos/process-photo";

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
};

export type PostState = { error?: string };

/**
 * Posts a found item or a lost note. A photo is optional: when it is
 * refused (a daily or storage limit, or an unreadable file) the person is
 * told and can post without it.
 */
export async function postAction(
  _previous: PostState,
  form: FormData,
): Promise<PostState> {
  const subject = await requirePermissionToChange("lost_found.use", {
    next: BOARD_PATH,
  });
  const league = await activeLeague();
  if (!league) notFound();
  const kind: ItemKind = text(form, "kind") === "lost" ? "lost" : "found";
  const chosen = text(form, "place");
  const cleaned = cleanPost({
    kind,
    description: text(form, "description"),
    place: chosen === ELSEWHERE ? text(form, "placeOther") : chosen,
    whereNow: text(form, "whereNow"),
  });
  if (!cleaned.ok) return { error: POST_MESSAGES[cleaned.error] };
  const file = form.get("photo");
  let photo = null;
  if (file instanceof File && file.size > 0) {
    const processed = await processPhoto(Buffer.from(await file.arrayBuffer()));
    if (!processed.ok) return { error: UPLOAD_MESSAGES[processed.error] };
    photo = await withThumbnail(processed.value);
  }
  const result = await txDb.transaction((tx) =>
    postItem(tx, {
      leagueId: league.id,
      posterId: subject.userId,
      post: cleaned.value,
      photo,
      now: new Date(),
    }),
  );
  if (!result.ok)
    return {
      error:
        result.error === "daily_posts"
          ? POST_MESSAGES.daily_posts
          : `${UPLOAD_MESSAGES[result.error]} You can still post without a photo.`,
    };
  redirect(`${BOARD_PATH}/${result.value}?done=posted`);
}

/** Sends the person back to a post with a notice the page words itself. */
function back(
  item: LostFoundItemId,
  key: "done" | "error",
  value: string,
): never {
  redirect(`${BOARD_PATH}/${item}?${key}=${value}`);
}

async function context(form: FormData) {
  const subject = await requirePermissionToChange("lost_found.use", {
    next: BOARD_PATH,
  });
  const league = await activeLeague();
  const item = parseId<LostFoundItemId>(text(form, "item"));
  if (!league || !item) notFound();
  return { subject, league, item };
}

/** "That's mine" or "I found it". */
export async function answerAction(form: FormData): Promise<void> {
  const { subject, league, item } = await context(form);
  const result = await txDb.transaction((tx) =>
    answerItem(tx, {
      leagueId: league.id,
      itemId: item,
      responderId: subject.userId,
      message: text(form, "message"),
      now: new Date(),
    }),
  );
  if (!result.ok) back(item, "error", result.error);
  back(item, "done", "answered");
}

export async function writeAction(form: FormData): Promise<void> {
  const { subject, league, item } = await context(form);
  const claim = parseId<LostFoundClaimId>(text(form, "claim"));
  if (!claim) notFound();
  const result = await txDb.transaction((tx) =>
    writeMessage(tx, {
      leagueId: league.id,
      claimId: claim,
      authorId: subject.userId,
      body: text(form, "body"),
      now: new Date(),
    }),
  );
  if (!result.ok) back(item, "error", result.error);
  back(item, "done", "sent");
}

export async function handOverAction(form: FormData): Promise<void> {
  const { subject, league, item } = await context(form);
  const claim = parseId<LostFoundClaimId>(text(form, "claim"));
  if (!claim) notFound();
  const result = await txDb.transaction((tx) =>
    handOver(tx, {
      leagueId: league.id,
      itemId: item,
      claimId: claim,
      posterId: subject.userId,
      now: new Date(),
    }),
  );
  if (!result.ok) back(item, "error", result.error);
  back(item, "done", "returned");
}

export async function closeAction(form: FormData): Promise<void> {
  const { subject, league, item } = await context(form);
  const result = await txDb.transaction((tx) =>
    closeOwnPost(tx, {
      leagueId: league.id,
      itemId: item,
      posterId: subject.userId,
      now: new Date(),
    }),
  );
  if (!result.ok) back(item, "error", result.error);
  redirect(`${BOARD_PATH}?done=closed`);
}

export async function withdrawAction(form: FormData): Promise<void> {
  const { subject, league, item } = await context(form);
  const claim = parseId<LostFoundClaimId>(text(form, "claim"));
  if (!claim) notFound();
  const result = await txDb.transaction((tx) =>
    withdrawClaim(tx, {
      leagueId: league.id,
      claimId: claim,
      responderId: subject.userId,
      now: new Date(),
    }),
  );
  if (!result.ok) back(item, "error", result.error);
  back(item, "done", "withdrawn");
}

/** An admin takes any post down. */
export async function removeAction(form: FormData): Promise<void> {
  const subject = await requirePermissionToChange("lost_found.manage", {
    next: BOARD_PATH,
  });
  const league = await activeLeague();
  const item = parseId<LostFoundItemId>(text(form, "item"));
  if (!league || !item) notFound();
  const result = await txDb.transaction((tx) =>
    removeItem(tx, {
      leagueId: league.id,
      itemId: item,
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  if (!result.ok) back(item, "error", result.error);
  redirect(`${BOARD_PATH}?done=removed`);
}
