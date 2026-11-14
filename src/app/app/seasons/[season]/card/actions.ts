"use server";

import { notFound, redirect } from "next/navigation";
import { db } from "@/db/client";
import { setCardPublic } from "@/db/queries/season-cards";
import { requireSelfToChange } from "@/lib/auth/permission";
import { refreshSeasonCards } from "@/lib/public-cache";

const pageOf = (slug: string) => `/app/seasons/${slug}/card`;

/**
 * The player makes their own season card's link public, or private again.
 * Only their own card can change; the public page and its image follow at
 * once.
 */
export async function setCardPublicAction(
  slug: string,
  makePublic: boolean,
): Promise<void> {
  const subject = await requireSelfToChange("profile.edit", pageOf(slug));
  const result = await setCardPublic(db, {
    userId: subject.userId,
    seasonSlug: slug,
    isPublic: makePublic,
  });
  if (!result.ok) notFound();
  refreshSeasonCards({ cardId: result.value.id });
  redirect(`${pageOf(slug)}?${makePublic ? "shared" : "unshared"}=1`);
}
