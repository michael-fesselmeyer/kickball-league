"use server";

import { redirect } from "next/navigation";
import { txDb } from "@/db/client";
import { acceptInvite } from "@/db/queries/invites";
import { requirePermissionToChange } from "@/lib/auth/permission";

export async function joinTeamAction(
  token: string,
  form: FormData,
): Promise<void> {
  const subject = await requirePermissionToChange("registration.join", {
    next: `/app/join/${token}`,
  });
  const result = await txDb.transaction((tx) =>
    acceptInvite(tx, {
      token,
      userId: subject.userId,
      ageConfirmed: form.get("ageConfirmed") === "yes",
      now: new Date(),
    }),
  );
  if (!result.ok) redirect(`/app/join/${token}?error=${result.error}`);
  redirect(`/app/seasons/${result.value.seasonSlug}?joined=1`);
}
