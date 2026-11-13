"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  deleteMemberPhoto,
  reviewMemberPhoto,
} from "@/db/queries/member-photos";
import { currentLeague } from "@/db/queries/seasons";
import { type MemberPhotoId, parseId } from "@/domain/ids";
import { NOTE_MAX } from "@/domain/member-photos/limits";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { refreshMemberPhotoPages } from "@/lib/public-cache";
import { sendQueuedSoon } from "@/services/outbox";

const PAGE = "/app/admin/photos";

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
};

async function photoToReview(form: FormData) {
  const subject = await requirePermissionToChange("photos.manage", {
    next: PAGE,
  });
  const league = await currentLeague(db);
  const id = parseId<MemberPhotoId>(text(form, "photo"));
  if (!league || !id) notFound();
  return { subject, league, id };
}

/**
 * Approves a waiting photo, or rejects it with an optional note that only
 * admins see. Either way the uploader hears, and an approved photo shows on
 * its pages at once.
 */
export async function reviewPhotoAction(form: FormData): Promise<void> {
  const { subject, league, id } = await photoToReview(form);
  const decision = text(form, "decision") === "approve" ? "approve" : "reject";
  const result = await txDb.transaction((tx) =>
    reviewMemberPhoto(tx, {
      leagueId: league.id,
      photoId: id,
      decision,
      note: text(form, "note").slice(0, NOTE_MAX),
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  if (!result.ok) redirect(`${PAGE}?error=${result.error}`);
  if (decision === "approve") refreshMemberPhotoPages();
  sendQueuedSoon();
  redirect(`${PAGE}?done=${decision === "approve" ? "approved" : "rejected"}`);
}

/** Takes any photo down for good, from every page. */
export async function deletePhotoAction(form: FormData): Promise<void> {
  const { subject, league, id } = await photoToReview(form);
  const result = await txDb.transaction((tx) =>
    deleteMemberPhoto(tx, {
      leagueId: league.id,
      photoId: id,
      actorId: subject.userId,
      asAdmin: true,
    }),
  );
  if (!result.ok) redirect(`${PAGE}?error=not_found`);
  if (result.value.wasShown) refreshMemberPhotoPages();
  redirect(`${PAGE}?done=deleted`);
}
