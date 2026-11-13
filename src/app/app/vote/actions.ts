"use server";

import { notFound, redirect } from "next/navigation";
import { txDb } from "@/db/client";
import { castVote } from "@/db/queries/awards";
import { type AwardPollId, parseId } from "@/domain/ids";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { formStrings } from "@/lib/form";
import { requireFeature } from "@/lib/platform/site";

const PAGE = "/app/vote";

/**
 * A player's one vote in an awards poll. Being on a roster in the poll's
 * season, the pick being on the ballot and the poll being open are all
 * checked by castVote; the database keeps it to one vote per poll.
 */
export async function castVoteAction(
  rawPollId: string,
  form: FormData,
): Promise<void> {
  await requireFeature("awards");
  const subject = await requirePermissionToChange("awards.vote", {
    next: PAGE,
  });
  const pollId = parseId<AwardPollId>(rawPollId);
  if (!pollId) notFound();
  const { nominee } = formStrings(form, ["nominee"] as const);
  const result = await castVote(txDb, {
    pollId,
    voterId: subject.userId,
    nomineeId: nominee,
    now: new Date(),
  });
  if (!result.ok) redirect(`${PAGE}?error=${result.error}`);
  redirect(`${PAGE}?voted=${pollId}`);
}
