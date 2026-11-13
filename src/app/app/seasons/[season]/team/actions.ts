"use server";

import { refresh } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { createTeamInvite } from "@/db/queries/invites";
import {
  myRegistration,
  seasonForRegistration,
} from "@/db/queries/registration";
import { currentLeague } from "@/db/queries/seasons";
import { can } from "@/domain/authz/permissions";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { setRsvp } from "@/db/queries/rsvps";
import { type GameId, parseId } from "@/domain/ids";
import { recordPaymentFor } from "../record-payment";

export type InviteState = { token?: string; expiresAt?: string };

/**
 * Makes a new team link for the captain's own team. The token comes back to
 * the page once, never in a URL the server logs.
 */
export async function createInviteAction(
  slug: string,
  previous: InviteState,
): Promise<InviteState> {
  const subject = await requirePermissionToChange("registration.join", {
    next: `/app/seasons/${slug}/team`,
  });
  const league = await currentLeague(db);
  const season = league
    ? await seasonForRegistration(db, league.id, slug)
    : null;
  if (!season) notFound();
  const mine = await myRegistration(db, season.id, subject.userId);
  const teamSeasonId = mine?.team?.teamSeasonId;
  if (
    !teamSeasonId ||
    !can(subject, "roster.manage", { teamSeasonId, targetRole: "player" })
  )
    notFound();
  const userId = subject.userId;
  const created = await txDb.transaction((tx) =>
    createTeamInvite(tx, { teamSeasonId, actorId: userId, now: new Date() }),
  );
  return {
    ...previous,
    token: created.token,
    expiresAt: created.expiresAt.toISOString(),
  };
}

/** A captain records a teammate's cash or Venmo payment. */
export async function recordTeamPaymentAction(
  slug: string,
  registrationId: string,
  form: FormData,
): Promise<void> {
  const page = `/app/seasons/${slug}/team`;
  const subject = await requirePermissionToChange("registration.join", {
    next: page,
  });
  const result = await recordPaymentFor(subject, slug, registrationId, form);
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  redirect(`${page}?notice=payment_recorded`);
}

/** A player answers in, out or maybe for one of their team's games. */
export async function rsvpAction(
  slug: string,
  rawGameId: string,
  form: FormData,
): Promise<void> {
  const page = `/app/seasons/${slug}/team`;
  const subject = await requirePermissionToChange("registration.join", {
    next: page,
  });
  const league = await currentLeague(db);
  const season = league
    ? await seasonForRegistration(db, league.id, slug)
    : null;
  const gameId = parseId<GameId>(rawGameId);
  const status = form.get("status");
  if (!season || !gameId) notFound();
  if (status !== "in" && status !== "out" && status !== "maybe")
    redirect(`${page}?error=invalid`);
  const mine = await myRegistration(db, season.id, subject.userId);
  if (!mine?.team) notFound();
  const result = await setRsvp(db, {
    gameId,
    userId: subject.userId,
    teamSeasonId: mine.team.teamSeasonId,
    status,
  });
  if (!result.ok) redirect(`${page}?error=${result.error}#game-${gameId}`);
  // Stay on the page, scrolled where the player tapped, with fresh counts.
  refresh();
}
