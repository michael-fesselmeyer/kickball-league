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
import {
  requirePermissionToChange,
  requireSelfToChange,
} from "@/lib/auth/permission";
import { setRsvp } from "@/db/queries/rsvps";
import {
  type CaptainHandoffId,
  type GameId,
  type KeepOffId,
  parseId,
  type UserId,
} from "@/domain/ids";
import {
  answerCaptaincy,
  cancelCaptaincy,
  offerCaptaincy,
  setTeamRole,
} from "@/db/queries/captaincy";
import { readEmail, readReason } from "@/domain/keep-off/keep-off";
import { addKeepOff, removeKeepOff, teamOfSeason } from "@/db/queries/keep-off";
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

/**
 * The captain's own team, for the "not on my team" list. Stops with a 404
 * for anyone who isn't a captain or co-captain of it, or an admin on it.
 */
async function keepOffContext(slug: string) {
  const page = `/app/seasons/${slug}/team`;
  const subject = await requirePermissionToChange("registration.join", {
    next: page,
  });
  const league = await currentLeague(db);
  const season = league
    ? await seasonForRegistration(db, league.id, slug)
    : null;
  if (!season) notFound();
  const mine = await myRegistration(db, season.id, subject.userId);
  const teamSeasonId = mine?.team?.teamSeasonId;
  if (!teamSeasonId || !can(subject, "keep_off.manage", { teamSeasonId }))
    notFound();
  const found = await teamOfSeason(db, teamSeasonId);
  if (!found) notFound();
  return { page: `${page}?keep_off=`, subject, teamId: found.teamId };
}

/** Adds a league member to the team's private list. They are never told. */
export async function addKeepOffAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const { page, subject, teamId } = await keepOffContext(slug);
  const email = readEmail(form.get("email"));
  if (!email) redirect(`${page}invalid_email#keep-off`);
  const reason = readReason(form.get("reason"));
  if (!reason.ok) redirect(`${page}${reason.error}#keep-off`);
  const result = await txDb.transaction((tx) =>
    addKeepOff(tx, {
      teamId,
      email,
      reason: reason.value,
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  redirect(`${page}${result.ok ? "added" : result.error}#keep-off`);
}

/** Takes someone off the team's private list. */
export async function removeKeepOffAction(
  slug: string,
  rawId: string,
): Promise<void> {
  const { page, subject, teamId } = await keepOffContext(slug);
  const id = parseId<KeepOffId>(rawId);
  if (!id) notFound();
  const result = await txDb.transaction((tx) =>
    removeKeepOff(tx, { id, teamId, actorId: subject.userId }),
  );
  if (!result.ok) notFound();
  redirect(`${page}removed#keep-off`);
}

/** The person's own team this season, for captaincy changes. */
async function ownTeam(slug: string, subject: { userId: UserId }) {
  const league = await currentLeague(db);
  const season = league
    ? await seasonForRegistration(db, league.id, slug)
    : null;
  if (!season) notFound();
  const mine = await myRegistration(db, season.id, subject.userId);
  const teamSeasonId = mine?.team?.teamSeasonId;
  if (!teamSeasonId) notFound();
  return teamSeasonId;
}

const captaincyPage = (slug: string, code: string) =>
  `/app/seasons/${slug}/team?captaincy=${code}`;

/** The captain offers the captaincy to a teammate. */
export async function offerCaptaincyAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const page = `/app/seasons/${slug}/team`;
  const subject = await requirePermissionToChange("registration.join", {
    next: page,
  });
  const teamSeasonId = await ownTeam(slug, subject);
  if (!can(subject, "captaincy.manage", { teamSeasonId })) notFound();
  const toUserId = parseId<UserId>(form.get("toUserId"));
  if (!toUserId) redirect(captaincyPage(slug, "not_on_team"));
  const result = await txDb.transaction((tx) =>
    offerCaptaincy(tx, {
      teamSeasonId,
      toUserId,
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  redirect(captaincyPage(slug, result.ok ? "offered" : result.error));
}

/** The captain withdraws the waiting offer. */
export async function cancelCaptaincyAction(slug: string): Promise<void> {
  const page = `/app/seasons/${slug}/team`;
  const subject = await requirePermissionToChange("registration.join", {
    next: page,
  });
  const teamSeasonId = await ownTeam(slug, subject);
  if (!can(subject, "captaincy.manage", { teamSeasonId })) notFound();
  const result = await txDb.transaction((tx) =>
    cancelCaptaincy(tx, {
      teamSeasonId,
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  redirect(captaincyPage(slug, result.ok ? "cancelled" : result.error));
}

/** The captain makes a teammate a co-captain, or a player again. */
export async function setTeamRoleAction(
  slug: string,
  rawUserId: string,
  role: "co_captain" | "player",
): Promise<void> {
  const page = `/app/seasons/${slug}/team`;
  const subject = await requirePermissionToChange("registration.join", {
    next: page,
  });
  const teamSeasonId = await ownTeam(slug, subject);
  if (!can(subject, "captaincy.manage", { teamSeasonId })) notFound();
  const userId = parseId<UserId>(rawUserId);
  if (!userId) notFound();
  const result = await txDb.transaction((tx) =>
    setTeamRole(tx, {
      teamSeasonId,
      userId,
      role,
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  redirect(captaincyPage(slug, result.ok ? role : result.error));
}

/** A co-captain steps down to a player. */
export async function stepDownAction(slug: string): Promise<void> {
  const page = `/app/seasons/${slug}/team`;
  const subject = await requireSelfToChange("captaincy.respond", page);
  const teamSeasonId = await ownTeam(slug, subject);
  const result = await txDb.transaction((tx) =>
    setTeamRole(tx, {
      teamSeasonId,
      userId: subject.userId,
      role: "player",
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  redirect(captaincyPage(slug, result.ok ? "stepped_down" : result.error));
}

/** The teammate offered the captaincy accepts or declines it. */
export async function answerCaptaincyAction(
  slug: string,
  rawHandoffId: string,
  accept: boolean,
): Promise<void> {
  const page = `/app/seasons/${slug}/team`;
  const subject = await requireSelfToChange("captaincy.respond", page);
  const handoffId = parseId<CaptainHandoffId>(rawHandoffId);
  if (!handoffId) notFound();
  const result = await txDb.transaction((tx) =>
    answerCaptaincy(tx, {
      handoffId,
      userId: subject.userId,
      accept,
      now: new Date(),
    }),
  );
  redirect(
    captaincyPage(
      slug,
      result.ok ? (accept ? "accepted" : "declined") : result.error,
    ),
  );
}
