"use server";

import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { referralCodeFor } from "@/db/queries/referrals";
import { requireSelfToChange } from "@/lib/auth/permission";

/** Makes the person's referral link the first time they ask for it. */
export async function makeReferralLinkAction(): Promise<void> {
  const subject = await requireSelfToChange("profile.edit", "/app/profile");
  await referralCodeFor(db, subject.userId);
  redirect("/app/profile#invite");
}
