"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { deleteAccount } from "@/db/queries/account";
import { profileOf } from "@/db/queries/profile";
import { isFreshSession } from "@/lib/auth/config";
import { requireSelfToChange, sessionSignedInAt } from "@/lib/auth/permission";
import { demoStatus } from "@/lib/demo/guard";
import { refreshMemberPhotoPages } from "@/lib/public-cache";

const PAGE = "/app/profile/delete";

/**
 * Deletes the signed-in person's account by anonymizing it. It needs a
 * session signed in within the fresh age and the person's own email address
 * typed again; the page explains both.
 */
export async function deleteAccountAction(form: FormData): Promise<void> {
  const subject = await requireSelfToChange("data.export_or_delete", PAGE);
  if (demoStatus(process.env).on) redirect(`${PAGE}?error=demo`);
  const signedInAt = await sessionSignedInAt();
  if (!signedInAt || !isFreshSession(signedInAt, new Date()))
    redirect(`${PAGE}?error=stale`);
  const me = await profileOf(db, subject.userId);
  if (!me) redirect(PAGE);
  const typed = String(form.get("confirm") ?? "")
    .trim()
    .toLowerCase();
  if (typed !== me.email.toLowerCase()) redirect(`${PAGE}?error=confirm`);

  const result = await txDb.transaction((tx) =>
    deleteAccount(tx, subject.userId, new Date()),
  );
  if (!result.ok) redirect(`${PAGE}?error=${result.error}`);
  // Their photos are gone, so pages that showed one drop it.
  refreshMemberPhotoPages();
  // The sessions are gone from the database; clear the browser's cookies too.
  const jar = await cookies();
  for (const { name } of jar.getAll())
    if (name.includes("better-auth."))
      jar.set(name, "", {
        maxAge: 0,
        path: "/",
        secure: name.startsWith("__Secure-"),
      });
  redirect("/account-deleted");
}
