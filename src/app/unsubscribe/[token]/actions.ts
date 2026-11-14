"use server";

import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { turnOffEmailTopic } from "@/db/queries/notifications";
import { env } from "@/env";
import { readUnsubscribeToken, unsubscribePagePath } from "@/lib/unsubscribe";

/** The unsubscribe page's button: turns that email topic off for the link's owner. */
export async function unsubscribeAction(token: string) {
  const found = readUnsubscribeToken(env.BETTER_AUTH_SECRET, token);
  if (!found) redirect(unsubscribePagePath(token));
  await turnOffEmailTopic(db, found.userId, found.topic);
  redirect(`${unsubscribePagePath(token)}?done=1`);
}
