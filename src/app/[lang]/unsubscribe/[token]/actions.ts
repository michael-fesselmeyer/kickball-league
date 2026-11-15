"use server";

import { redirect } from "next/navigation";
import { db } from "@/db/client";
import {
  TURN_DOWNS,
  type TurnDown,
  turnDown,
} from "@/db/queries/alert-choices";
import { turnOffEmailTopic } from "@/db/queries/notifications";
import { DEFAULT_TIME_ZONE } from "@/db/queries/outbox";
import { env } from "@/env";
import { activeLeague } from "@/lib/league/active";
import { readUnsubscribeToken, unsubscribePagePath } from "@/lib/unsubscribe";

/** The unsubscribe page's button: turns that email topic off for the link's owner. */
export async function unsubscribeAction(token: string) {
  const found = readUnsubscribeToken(env.BETTER_AUTH_SECRET, token);
  if (!found) redirect(unsubscribePagePath(token));
  await turnOffEmailTopic(db, found.userId, found.topic);
  redirect(`${unsubscribePagePath(token)}?done=1`);
}

const isTurnDown = (v: string): v is TurnDown =>
  (TURN_DOWNS as readonly string[]).includes(v);

/**
 * The page's "turn down instead" buttons (issue #529): only my team, a
 * weekly digest, or a two-week snooze, for the link's owner.
 */
export async function turnDownAction(token: string, choice: string) {
  const found = readUnsubscribeToken(env.BETTER_AUTH_SECRET, token);
  if (!found || !isTurnDown(choice)) redirect(unsubscribePagePath(token));
  const league = await activeLeague();
  await turnDown(db, found.userId, choice, {
    topic: found.topic,
    now: new Date(),
    timeZone: league?.timeZone ?? DEFAULT_TIME_ZONE,
  });
  redirect(`${unsubscribePagePath(token)}?done=${choice}`);
}
