"use server";

import { redirect } from "next/navigation";
import { txDb } from "@/db/client";
import { acceptInvite } from "@/db/queries/invites";
import { requirePermission } from "@/lib/auth/permission";

export async function joinTeamAction(token: string): Promise<void> {
  const subject = await requirePermission("registration.join", {
    next: `/app/join/${token}`,
  });
  const result = await txDb.transaction((tx) =>
    acceptInvite(tx, { token, userId: subject.userId, now: new Date() }),
  );
  if (!result.ok) redirect(`/app/join/${token}?error=${result.error}`);
  redirect(`/app/seasons/${result.value.seasonSlug}?joined=1`);
}
