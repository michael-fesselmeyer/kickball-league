"use server";

import { notFound, redirect } from "next/navigation";
import { txDb } from "@/db/client";
import { castVote } from "@/db/queries/captain-polls";
import {
  type CaptainPollId,
  type CaptainPollOptionId,
  parseId,
  type TeamSeasonId,
} from "@/domain/ids";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { formStrings } from "@/lib/form";
import { requireInLeague } from "@/lib/league/guard";

const PAGE = "/app/polls";

/**
 * A team's vote in a captains' poll, or a change to it. The permission
 * check needs the person to captain (or co-captain) that team; castVote
 * checks the poll is open, who may vote and that the option is the poll's.
 */
export async function castPollVoteAction(
  rawPollId: string,
  form: FormData,
): Promise<void> {
  const { team, option } = formStrings(form, ["team", "option"] as const);
  const pollId = parseId<CaptainPollId>(rawPollId);
  const teamSeasonId = parseId<TeamSeasonId>(team);
  const optionId = parseId<CaptainPollOptionId>(option);
  if (!pollId || !teamSeasonId) notFound();
  const subject = await requirePermissionToChange("captain_polls.vote", {
    teamSeasonId,
    next: PAGE,
  });
  await requireInLeague(subject, { captain_poll: pollId });
  if (!optionId) redirect(`${PAGE}?error=not_an_option`);
  const result = await castVote(txDb, {
    pollId,
    teamSeasonId,
    optionId,
    voterId: subject.userId,
    now: new Date(),
  });
  if (!result.ok) redirect(`${PAGE}?error=${result.error}`);
  redirect(`${PAGE}?voted=${pollId}`);
}
