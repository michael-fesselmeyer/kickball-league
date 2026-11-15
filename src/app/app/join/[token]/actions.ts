"use server";

import { redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { acceptInvite, inviteByToken } from "@/db/queries/invites";
import { saveShirtSize, shirtSettings } from "@/db/queries/shirt-order";
import { pickSize } from "@/domain/shirts/order";
import { requirePermissionToChange } from "@/lib/auth/permission";

export async function joinTeamAction(
  token: string,
  form: FormData,
): Promise<void> {
  const subject = await requirePermissionToChange("registration.join", {
    next: `/app/join/${token}`,
  });
  const now = new Date();
  const found = await inviteByToken(db, token, now, subject.userId);
  const sizes = found ? (await shirtSettings(db, found.seasonId)).sizes : [];
  const shirtSize = pickSize(form.get("shirtSize"), sizes);
  if (found && !shirtSize) redirect(`/app/join/${token}?error=shirt_size`);
  const result = await txDb.transaction(async (tx) => {
    const joined = await acceptInvite(tx, {
      token,
      userId: subject.userId,
      ageConfirmed: form.get("ageConfirmed") === "yes",
      now,
    });
    if (joined.ok && shirtSize)
      await saveShirtSize(tx, { userId: subject.userId, size: shirtSize });
    return joined;
  });
  if (!result.ok) redirect(`/app/join/${token}?error=${result.error}`);
  redirect(`/app/seasons/${result.value.seasonSlug}?joined=1`);
}
