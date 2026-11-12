import { and, eq, isNull, ne } from "drizzle-orm";
import type { RegistrationId, TeamSeasonId, UserId } from "@/domain/ids";
import {
  hashInviteToken,
  inviteExpiry,
  looksLikeInviteToken,
  newInviteToken,
} from "@/domain/invite/token";
import { registrationWindow } from "@/domain/registration/pricing";
import { err, ok, type Result } from "@/domain/result";
import { user } from "../schema/auth";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import {
  invite,
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { recordAudit } from "./audit";
import { settleCoveredRegistrations } from "./payments";
import { seasonForRegistration, startingState } from "./registration";
import type { Db } from "./schedule";
import { required } from "./rows";

/**
 * Makes a new team link and revokes the team's earlier ones, so a link
 * shared too widely can be shut off. Returns the token: it is shown once and
 * only its hash is kept.
 */
export async function createTeamInvite(
  db: Db,
  input: { teamSeasonId: TeamSeasonId; actorId: UserId; now: Date },
): Promise<{ token: string; expiresAt: Date }> {
  await db
    .update(invite)
    .set({ status: "revoked" })
    .where(
      and(
        eq(invite.teamSeasonId, input.teamSeasonId),
        eq(invite.status, "open"),
        isNull(invite.email),
      ),
    );
  const token = newInviteToken();
  const expiresAt = inviteExpiry(input.now);
  const [created] = await db
    .insert(invite)
    .values({
      teamSeasonId: input.teamSeasonId,
      tokenHash: hashInviteToken(token),
      expiresAt,
      createdBy: input.actorId,
    })
    .returning({ id: invite.id });
  await recordAudit(db, {
    actorId: input.actorId,
    action: "invite.create",
    entityType: "team_season",
    entityId: input.teamSeasonId,
    after: { inviteId: created?.id, expiresAt },
  });
  return { token, expiresAt };
}

/** Whether the team has a working link, without revealing it. */
export async function openTeamInvite(
  db: Db,
  teamSeasonId: TeamSeasonId,
  now: Date,
) {
  const [found] = await db
    .select({ expiresAt: invite.expiresAt })
    .from(invite)
    .where(
      and(
        eq(invite.teamSeasonId, teamSeasonId),
        eq(invite.status, "open"),
        isNull(invite.email),
      ),
    );
  return found && found.expiresAt > now ? found : null;
}

async function activeMembers(db: Db, teamSeasonId: TeamSeasonId) {
  const rows = await db
    .select({ id: rosterMembership.id })
    .from(rosterMembership)
    .where(
      and(
        eq(rosterMembership.teamSeasonId, teamSeasonId),
        eq(rosterMembership.status, "active"),
      ),
    );
  return rows.length;
}

/** What a link leads to, for the join page. Null when it is not a link. */
export async function inviteByToken(db: Db, token: string, now: Date) {
  if (!looksLikeInviteToken(token)) return null;
  const [found] = await db
    .select({
      id: invite.id,
      status: invite.status,
      expiresAt: invite.expiresAt,
      teamSeasonId: teamSeason.id,
      teamName: team.name,
      teamColor: team.colorHex,
      shareCents: teamSeason.shareCents,
      paymentMode: teamSeason.paymentMode,
      leagueId: season.leagueId,
      seasonSlug: season.slug,
      seasonName: season.name,
      rosterMax: season.rosterMax,
    })
    .from(invite)
    .innerJoin(teamSeason, eq(invite.teamSeasonId, teamSeason.id))
    .innerJoin(team, eq(teamSeason.teamId, team.id))
    .innerJoin(season, eq(teamSeason.seasonId, season.id))
    .where(eq(invite.tokenHash, hashInviteToken(token)));
  if (!found) return null;
  const members = await activeMembers(db, found.teamSeasonId);
  const state =
    found.status !== "open"
      ? found.status
      : found.expiresAt <= now
        ? ("expired" as const)
        : ("open" as const);
  return { ...found, state, members };
}

export type AcceptError =
  | "invalid"
  | "expired"
  | "revoked"
  | "closed"
  | "full"
  | "already_member"
  | "on_another_team";

/**
 * Puts the person on the team through a link: a new registration, or their
 * free-agent registration, gets an active player spot. Their waiver and
 * payment carry on from there.
 */
export async function acceptInvite(
  db: Db,
  input: { token: string; userId: UserId; now: Date },
): Promise<Result<{ seasonSlug: string; teamName: string }, AcceptError>> {
  const found = await inviteByToken(db, input.token, input.now);
  if (!found) return err("invalid");
  if (found.state === "expired") return err("expired");
  if (found.state !== "open") return err("revoked");
  const s = await seasonForRegistration(db, found.leagueId, found.seasonSlug);
  if (!s || registrationWindow(s, input.now) !== "open") return err("closed");

  const [existing] = await db
    .select({ id: registration.id })
    .from(registration)
    .where(
      and(
        eq(registration.seasonId, s.id),
        eq(registration.userId, input.userId),
        ne(registration.status, "cancelled"),
      ),
    );
  if (existing) {
    const [spot] = await db
      .select({ teamSeasonId: rosterMembership.teamSeasonId })
      .from(rosterMembership)
      .where(
        and(
          eq(rosterMembership.registrationId, existing.id),
          eq(rosterMembership.status, "active"),
        ),
      );
    if (spot)
      return err(
        spot.teamSeasonId === found.teamSeasonId
          ? "already_member"
          : "on_another_team",
      );
  }
  if (found.members >= found.rosterMax) return err("full");

  let registrationId: RegistrationId;
  if (existing) {
    // A free agent who joins a team becomes a team member.
    await db
      .update(registration)
      .set({ kind: "team_member" })
      .where(eq(registration.id, existing.id));
    registrationId = existing.id;
  } else {
    const [created] = await db
      .insert(registration)
      .values({
        seasonId: s.id,
        userId: input.userId,
        kind: "team_member",
        ...(await startingState(db, s, input.userId)),
        createdBy: input.userId,
      })
      .returning({ id: registration.id });
    registrationId = required(created, "registration").id;
  }
  await db.insert(rosterMembership).values({
    teamSeasonId: found.teamSeasonId,
    registrationId,
    role: "player",
    status: "active",
    startedAt: input.now,
    createdBy: input.userId,
  });
  await settleCoveredRegistrations(db, found.teamSeasonId);
  return ok({ seasonSlug: found.seasonSlug, teamName: found.teamName });
}

/**
 * The roster board: who joined, signed the waiver and paid. Paid means the
 * registration is active, which only the payment webhook sets.
 */
export async function rosterBoard(db: Db, teamSeasonId: TeamSeasonId) {
  const rows = await db
    .select({
      registrationId: registration.id,
      userId: registration.userId,
      firstName: profile.firstName,
      lastName: profile.lastName,
      accountName: user.name,
      role: rosterMembership.role,
      startedAt: rosterMembership.startedAt,
      status: registration.status,
      waiverSignatureId: registration.waiverSignatureId,
    })
    .from(rosterMembership)
    .innerJoin(
      registration,
      eq(rosterMembership.registrationId, registration.id),
    )
    .innerJoin(user, eq(registration.userId, user.id))
    .leftJoin(profile, eq(profile.userId, user.id))
    .where(
      and(
        eq(rosterMembership.teamSeasonId, teamSeasonId),
        eq(rosterMembership.status, "active"),
      ),
    );
  const order = { captain: 0, co_captain: 1, player: 2 };
  return rows
    .map((r) => ({
      registrationId: r.registrationId,
      userId: r.userId,
      name:
        r.firstName && r.lastName
          ? `${r.firstName} ${r.lastName}`
          : r.accountName || "New player",
      role: r.role,
      joinedAt: r.startedAt,
      signed: r.waiverSignatureId !== null || r.status !== "pending_waiver",
      paid: r.status === "active",
    }))
    .sort(
      (a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name),
    );
}
