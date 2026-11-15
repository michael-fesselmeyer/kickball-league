"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { inviteOpenPlayers, recruitingTeam } from "@/db/queries/move";
import {
  myRegistration,
  seasonForRegistration,
} from "@/db/queries/registration";
import { can } from "@/domain/authz/permissions";
import { readMessage } from "@/domain/move/move";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";
import { sendQueuedSoon } from "@/services/outbox";

/**
 * A recruiting captain invites every player open to a move that their team
 * may invite (ADR 0089), without learning who. The queries leave out
 * anyone who has played for the team and anyone it keeps off. Each player
 * gets at most one invite from a team, so pressing again only reaches
 * players who opened up since.
 */
export async function inviteOpenPlayersAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const page = `/app/seasons/${slug}/team`;
  const back = (code: string): never =>
    redirect(`${page}?recruit=${code}#recruiting`);
  const subject = await requirePermissionToChange("registration.join", {
    next: page,
  });
  const league = await activeLeague();
  const season = league
    ? await seasonForRegistration(db, league.id, slug)
    : null;
  if (!season) notFound();
  const mine = await myRegistration(db, season.id, subject.userId);
  const teamSeasonId = mine?.team?.teamSeasonId;
  if (!teamSeasonId || !can(subject, "move.recruit", { teamSeasonId }))
    notFound();
  const now = new Date();
  const recruiting = await recruitingTeam(db, teamSeasonId, now);
  if (!recruiting) return back("closed");
  const message = readMessage(form.get("message"));
  if (!message.ok) return back(message.error);
  const sent = await txDb.transaction((tx) =>
    inviteOpenPlayers(tx, {
      recruiting,
      actorId: subject.userId,
      message: message.value,
      now,
    }),
  );
  if (sent > 0) sendQueuedSoon();
  back(sent > 0 ? "sent" : "none");
}
