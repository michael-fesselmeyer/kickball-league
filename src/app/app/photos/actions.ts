"use server";

import { refresh } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  deleteMemberPhoto,
  uploadMemberPhoto,
} from "@/db/queries/member-photos";
import { currentLeague } from "@/db/queries/seasons";
import {
  type EventId,
  type GameId,
  type MemberPhotoId,
  parseId,
  type TeamId,
} from "@/domain/ids";
import { UPLOAD_MESSAGES } from "@/domain/member-photos/limits";
import {
  requirePermissionToChange,
  requireSelfToChange,
} from "@/lib/auth/permission";
import { processPhoto } from "@/lib/member-photos/process-photo";
import { refreshMemberPhotoPages } from "@/lib/public-cache";

const PAGE = "/app/photos";

export type UploadState = {
  error?: string;
  /** Counts successful uploads, so the form clears after each one. */
  sent: number;
};

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
};

/**
 * Takes one photo for the league's review queue (ADR 0035): checks it is
 * really a photo, shrinks it and strips its metadata, then stores it if the
 * uploader may tag what they chose and the limits allow.
 */
export async function uploadPhotoAction(
  previous: UploadState,
  form: FormData,
): Promise<UploadState> {
  const subject = await requirePermissionToChange("photos.upload", {
    next: PAGE,
  });
  const league = await currentLeague(db);
  if (!league) notFound();
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0)
    return { ...previous, error: UPLOAD_MESSAGES.empty };
  const processed = await processPhoto(Buffer.from(await file.arrayBuffer()));
  if (!processed.ok)
    return { ...previous, error: UPLOAD_MESSAGES[processed.error] };

  const result = await txDb.transaction((tx) =>
    uploadMemberPhoto(tx, {
      leagueId: league.id,
      uploaderId: subject.userId,
      photo: processed.value,
      gameId: parseId<GameId>(text(form, "game")),
      eventId: parseId<EventId>(text(form, "event")),
      teamId: parseId<TeamId>(text(form, "team")),
      caption: text(form, "caption"),
      consent: text(form, "consent") === "yes",
      now: new Date(),
    }),
  );
  if (!result.ok) return { ...previous, error: UPLOAD_MESSAGES[result.error] };
  refresh();
  return { sent: previous.sent + 1 };
}

/** The uploader deletes their own photo, shown or not. */
export async function deleteMyPhotoAction(form: FormData): Promise<void> {
  const subject = await requireSelfToChange("photos.delete_own", PAGE);
  const league = await currentLeague(db);
  const id = parseId<MemberPhotoId>(text(form, "photo"));
  if (!league || !id) notFound();
  const result = await txDb.transaction((tx) =>
    deleteMemberPhoto(tx, {
      leagueId: league.id,
      photoId: id,
      actorId: subject.userId,
      asAdmin: false,
    }),
  );
  if (result.ok && result.value.wasShown) refreshMemberPhotoPages();
  redirect(`${PAGE}?done=deleted`);
}
