"use server";

import { notFound, redirect } from "next/navigation";
import { txDb } from "@/db/client";
import { claimSubSpot, withdrawSubClaim } from "@/db/queries/subs";
import { parseId, type SubRequestId } from "@/domain/ids";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { sendQueuedSoon } from "@/services/outbox";
import { requireFeature } from "@/lib/platform/site";

const PAGE = "/app/subs";

/**
 * A player says "I'm in" for a request. The eligibility half of
 * sub_request.claim (registered, waiver signed, free at that time) is
 * checked by claimSubSpot inside its transaction, under the request's lock.
 */
export async function claimAction(rawRequestId: string): Promise<void> {
  await requireFeature("subs");
  const subject = await requirePermissionToChange("registration.join", {
    next: PAGE,
  });
  const requestId = parseId<SubRequestId>(rawRequestId);
  if (!requestId) notFound();
  const result = await claimSubSpot(txDb, {
    requestId,
    userId: subject.userId,
    now: new Date(),
  });
  if (!result.ok) redirect(`${PAGE}?error=${result.error}`);
  sendQueuedSoon();
  redirect(`${PAGE}?notice=claimed`);
}

/** A player drops out of a request they offered for. */
export async function withdrawAction(rawRequestId: string): Promise<void> {
  await requireFeature("subs");
  const subject = await requirePermissionToChange("registration.join", {
    next: PAGE,
  });
  const requestId = parseId<SubRequestId>(rawRequestId);
  if (!requestId) notFound();
  const result = await withdrawSubClaim(txDb, {
    requestId,
    userId: subject.userId,
    now: new Date(),
  });
  if (!result.ok) redirect(`${PAGE}?error=${result.error}`);
  sendQueuedSoon();
  redirect(`${PAGE}?notice=withdrawn`);
}
