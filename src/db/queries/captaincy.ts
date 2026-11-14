import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import {
  checkAccept,
  checkOffer,
  checkRoleChange,
  type AcceptError,
  type Member,
  type OfferError,
  type RoleChangeError,
  rolesAfterHandoff,
} from "@/domain/captaincy/captaincy";
import type {
  CaptainHandoffId,
  RosterMembershipId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import type { TeamRolePayload } from "@/emails/team-role";
import { user } from "../schema/auth";
import { captainHandoff } from "../schema/captaincy";
import { purchase, purchaseItem } from "../schema/money";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { recordAudit } from "./audit";
import { enqueueMessages, type OutboxMessage } from "./outbox";
import type { Db } from "./schedule";

/**
 * Captain handoff and co-captains (ADR 0042). The rules are in
 * src/domain/captaincy; this file reads and writes roster roles and offers.
 * Every change locks the team season's row first, so two answers to the
 * same offer, or an offer and a role change, are served one at a time.
 */

/** "Jo S.": first name and last initial, as on public rosters. */
const shortName = sql<string>`coalesce(${profile.firstName} || coalesce(' ' || left(${profile.lastName}, 1) || '.', ''), nullif(${user.name}, ''), 'A player')`;

export type TeamMember = {
  membershipId: RosterMembershipId;
  userId: UserId;
  name: string;
  role: "captain" | "co_captain" | "player";
};

/** The team's active roster with roles, captain first. */
async function members(
  db: Db,
  teamSeasonId: TeamSeasonId,
): Promise<TeamMember[]> {
  const rows = await db
    .select({
      membershipId: rosterMembership.id,
      userId: registration.userId,
      name: shortName,
      role: rosterMembership.role,
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
    )
    .orderBy(asc(shortName));
  const order = { captain: 0, co_captain: 1, player: 2 };
  return rows.sort((a, b) => order[a.role] - order[b.role]);
}

const asMember = (m: TeamMember | undefined): Member<UserId> =>
  m ? { userId: m.userId, role: m.role } : null;

/** Whether someone is paying the team fee right now (an open checkout). */
async function teamFeeCheckoutOpen(
  db: Db,
  teamSeasonId: TeamSeasonId,
): Promise<boolean> {
  const [open] = await db
    .select({ id: purchase.id })
    .from(purchaseItem)
    .innerJoin(purchase, eq(purchaseItem.purchaseId, purchase.id))
    .where(
      and(
        eq(purchaseItem.teamSeasonId, teamSeasonId),
        eq(purchaseItem.kind, "team_fee"),
        eq(purchase.status, "open"),
      ),
    )
    .limit(1);
  return open !== undefined;
}

/** Locks the team season and returns what messages need to name it. */
async function lockTeam(db: Db, teamSeasonId: TeamSeasonId) {
  const [row] = await db
    .select({
      team: team.name,
      seasonName: season.name,
      seasonSlug: season.slug,
    })
    .from(teamSeason)
    .innerJoin(team, eq(teamSeason.teamId, team.id))
    .innerJoin(season, eq(teamSeason.seasonId, season.id))
    .where(eq(teamSeason.id, teamSeasonId))
    .for("update", { of: teamSeason });
  return row ?? null;
}

const notice = (
  userId: UserId,
  template: "captain_handoff" | "team_role",
  payload: TeamRolePayload,
  dedupeKey: string,
  now: Date,
): OutboxMessage => ({
  userId,
  topic: "team_roles",
  template,
  payload,
  dedupeKey,
  sendAfter: now,
});

export type PendingOffer = {
  id: CaptainHandoffId;
  fromUserId: UserId;
  toUserId: UserId;
  toName: string;
  fromName: string;
  createdAt: Date;
};

export type Captaincy = { members: TeamMember[]; pending: PendingOffer | null };

/**
 * Each team's roles and any offer waiting, in two queries for any number
 * of teams: one team for its page, every team for the admin screen.
 */
export async function captaincies(
  db: Db,
  teamSeasonIds: readonly TeamSeasonId[],
): Promise<Map<TeamSeasonId, Captaincy>> {
  const result = new Map<TeamSeasonId, Captaincy>();
  if (teamSeasonIds.length === 0) return result;
  const [roster, offers] = await Promise.all([
    db
      .select({
        teamSeasonId: rosterMembership.teamSeasonId,
        membershipId: rosterMembership.id,
        userId: registration.userId,
        name: shortName,
        role: rosterMembership.role,
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
          inArray(rosterMembership.teamSeasonId, [...teamSeasonIds]),
          eq(rosterMembership.status, "active"),
        ),
      )
      .orderBy(asc(shortName)),
    db
      .select({
        teamSeasonId: captainHandoff.teamSeasonId,
        id: captainHandoff.id,
        fromUserId: captainHandoff.fromUserId,
        toUserId: captainHandoff.toUserId,
        createdAt: captainHandoff.createdAt,
      })
      .from(captainHandoff)
      .where(
        and(
          inArray(captainHandoff.teamSeasonId, [...teamSeasonIds]),
          eq(captainHandoff.status, "pending"),
        ),
      ),
  ]);
  const order = { captain: 0, co_captain: 1, player: 2 };
  for (const id of teamSeasonIds) {
    const members = roster
      .filter((m) => m.teamSeasonId === id)
      .map((m) => ({
        membershipId: m.membershipId,
        userId: m.userId,
        name: m.name,
        role: m.role,
      }))
      .sort((a, b) => order[a.role] - order[b.role]);
    const offer = offers.find((o) => o.teamSeasonId === id);
    const nameOf = (userId: UserId) =>
      members.find((m) => m.userId === userId)?.name ?? "A former teammate";
    result.set(id, {
      members,
      pending: offer
        ? {
            id: offer.id,
            fromUserId: offer.fromUserId,
            toUserId: offer.toUserId,
            createdAt: offer.createdAt,
            toName: nameOf(offer.toUserId),
            fromName: nameOf(offer.fromUserId),
          }
        : null,
    });
  }
  return result;
}

/** One team's roles and any offer waiting, for the team page. */
export async function teamCaptaincy(
  db: Db,
  teamSeasonId: TeamSeasonId,
): Promise<Captaincy> {
  return (
    (await captaincies(db, [teamSeasonId])).get(teamSeasonId) ?? {
      members: [],
      pending: null,
    }
  );
}

/**
 * Offers the captaincy to a teammate. The captain keeps the role until they
 * accept; an earlier waiting offer is cancelled. Tells the teammate.
 */
export async function offerCaptaincy(
  db: Db,
  input: {
    teamSeasonId: TeamSeasonId;
    toUserId: UserId;
    actorId: UserId;
    now: Date;
  },
): Promise<Result<CaptainHandoffId, OfferError | "not_found">> {
  const about = await lockTeam(db, input.teamSeasonId);
  if (!about) return err("not_found");
  const roster = await members(db, input.teamSeasonId);
  const allowed = checkOffer({
    captain: asMember(roster.find((m) => m.role === "captain")),
    to: asMember(roster.find((m) => m.userId === input.toUserId)),
    teamFeeCheckoutOpen: await teamFeeCheckoutOpen(db, input.teamSeasonId),
  });
  if (!allowed.ok) return allowed;
  const { fromUserId, toUserId } = allowed.value;
  await db
    .update(captainHandoff)
    .set({ status: "cancelled", decidedAt: input.now })
    .where(
      and(
        eq(captainHandoff.teamSeasonId, input.teamSeasonId),
        eq(captainHandoff.status, "pending"),
      ),
    );
  const [created] = await db
    .insert(captainHandoff)
    .values({
      teamSeasonId: input.teamSeasonId,
      fromUserId,
      toUserId,
      createdBy: input.actorId,
      createdAt: input.now,
    })
    .returning({ id: captainHandoff.id });
  if (!created) throw new Error("Expected a captain handoff row");
  await recordAudit(db, {
    actorId: input.actorId,
    action: "captaincy.offer",
    entityType: "team_season",
    entityId: input.teamSeasonId,
    after: { handoffId: created.id, fromUserId, toUserId },
  });
  const captain =
    roster.find((m) => m.userId === fromUserId)?.name ?? "Your captain";
  await enqueueMessages(db, [
    notice(
      toUserId,
      "captain_handoff",
      { ...about, kind: "offered", captain },
      `captaincy/${created.id}/offered`,
      input.now,
    ),
  ]);
  return ok(created.id);
}

/** The team an offer is for, so the caller can check permissions. */
export async function handoffTeam(
  db: Db,
  id: CaptainHandoffId,
): Promise<{ teamSeasonId: TeamSeasonId; toUserId: UserId } | null> {
  const [row] = await db
    .select({
      teamSeasonId: captainHandoff.teamSeasonId,
      toUserId: captainHandoff.toUserId,
    })
    .from(captainHandoff)
    .where(eq(captainHandoff.id, id));
  return row ?? null;
}

/**
 * The teammate's answer. Accepting swaps the roles in one transaction: the
 * old captain becomes a co-captain and the teammate the captain. Either
 * way the captain who offered is told.
 */
export async function answerCaptaincy(
  db: Db,
  input: {
    handoffId: CaptainHandoffId;
    userId: UserId;
    accept: boolean;
    now: Date;
  },
): Promise<Result<void, AcceptError | "not_found">> {
  const found = await handoffTeam(db, input.handoffId);
  if (!found || found.toUserId !== input.userId) return err("not_found");
  const about = await lockTeam(db, found.teamSeasonId);
  if (!about) return err("not_found");
  const [offer] = await db
    .select({
      status: captainHandoff.status,
      fromUserId: captainHandoff.fromUserId,
    })
    .from(captainHandoff)
    .where(eq(captainHandoff.id, input.handoffId));
  if (!offer) return err("not_found");
  const roster = await members(db, found.teamSeasonId);
  const me = roster.find((m) => m.userId === input.userId);
  const player = me?.name ?? "Your teammate";

  if (!input.accept) {
    if (offer.status !== "pending") return err("not_pending");
    await settle(db, input.handoffId, "declined", input.now);
    await recordAudit(db, {
      actorId: input.userId,
      action: "captaincy.decline",
      entityType: "team_season",
      entityId: found.teamSeasonId,
      after: { handoffId: input.handoffId },
    });
    await enqueueMessages(db, [
      notice(
        offer.fromUserId,
        "team_role",
        { ...about, kind: "declined", player },
        `captaincy/${input.handoffId}/declined`,
        input.now,
      ),
    ]);
    return ok(undefined);
  }

  const captain = roster.find((m) => m.role === "captain");
  const allowed = checkAccept({
    status: offer.status,
    fromUserId: offer.fromUserId,
    captain: asMember(captain),
    to: asMember(me),
    teamFeeCheckoutOpen: await teamFeeCheckoutOpen(db, found.teamSeasonId),
  });
  if (!allowed.ok) {
    // An offer that can never be taken up any more is closed, not left waiting.
    if (allowed.error === "captain_changed" || allowed.error === "not_on_team")
      await settle(db, input.handoffId, "cancelled", input.now);
    return allowed;
  }
  if (!captain || !me) return err("not_found");
  // Old captain first, so the one-captain index never sees two.
  await db
    .update(rosterMembership)
    .set({ role: rolesAfterHandoff.oldCaptain })
    .where(eq(rosterMembership.id, captain.membershipId));
  await db
    .update(rosterMembership)
    .set({ role: rolesAfterHandoff.newCaptain })
    .where(eq(rosterMembership.id, me.membershipId));
  await settle(db, input.handoffId, "accepted", input.now);
  await recordAudit(db, {
    actorId: input.userId,
    action: "captaincy.accept",
    entityType: "team_season",
    entityId: found.teamSeasonId,
    before: { captain: captain.userId },
    after: { captain: input.userId },
  });
  await enqueueMessages(db, [
    notice(
      offer.fromUserId,
      "team_role",
      { ...about, kind: "accepted", player },
      `captaincy/${input.handoffId}/accepted`,
      input.now,
    ),
  ]);
  return ok(undefined);
}

async function settle(
  db: Db,
  id: CaptainHandoffId,
  status: "accepted" | "declined" | "cancelled",
  now: Date,
) {
  await db
    .update(captainHandoff)
    .set({ status, decidedAt: now })
    .where(eq(captainHandoff.id, id));
}

/** Withdraws the team's waiting offer, quietly. */
export async function cancelCaptaincy(
  db: Db,
  input: { teamSeasonId: TeamSeasonId; actorId: UserId; now: Date },
): Promise<Result<void, "not_found">> {
  if (!(await lockTeam(db, input.teamSeasonId))) return err("not_found");
  const [cancelled] = await db
    .update(captainHandoff)
    .set({ status: "cancelled", decidedAt: input.now })
    .where(
      and(
        eq(captainHandoff.teamSeasonId, input.teamSeasonId),
        eq(captainHandoff.status, "pending"),
      ),
    )
    .returning({ id: captainHandoff.id });
  if (!cancelled) return err("not_found");
  await recordAudit(db, {
    actorId: input.actorId,
    action: "captaincy.cancel",
    entityType: "team_season",
    entityId: input.teamSeasonId,
    after: { handoffId: cancelled.id },
  });
  return ok(undefined);
}

/**
 * Makes a teammate a co-captain, or a player again. The captain's own role
 * never changes here. Tells the teammate, unless they stepped down
 * themselves.
 */
export async function setTeamRole(
  db: Db,
  input: {
    teamSeasonId: TeamSeasonId;
    userId: UserId;
    role: "co_captain" | "player";
    actorId: UserId;
    now: Date;
  },
): Promise<Result<void, RoleChangeError | "not_found">> {
  const about = await lockTeam(db, input.teamSeasonId);
  if (!about) return err("not_found");
  const roster = await members(db, input.teamSeasonId);
  const member = roster.find((m) => m.userId === input.userId);
  const allowed = checkRoleChange(asMember(member), input.role);
  if (!allowed.ok) return allowed;
  if (!member) return err("not_on_team");
  await db
    .update(rosterMembership)
    .set({ role: input.role })
    .where(eq(rosterMembership.id, member.membershipId));
  await recordAudit(db, {
    actorId: input.actorId,
    action:
      input.role === "co_captain"
        ? "captaincy.add_co_captain"
        : "captaincy.remove_co_captain",
    entityType: "team_season",
    entityId: input.teamSeasonId,
    before: { userId: input.userId, role: member.role },
    after: { userId: input.userId, role: input.role },
  });
  if (input.actorId !== input.userId)
    await enqueueMessages(db, [
      notice(
        input.userId,
        "team_role",
        { ...about, kind: input.role },
        `team_role/${member.membershipId}/${input.role}/${input.now.getTime()}`,
        input.now,
      ),
    ]);
  return ok(undefined);
}

/** The offer waiting for this person on this team, for their team page. */
export async function offerFor(
  db: Db,
  teamSeasonId: TeamSeasonId,
  userId: UserId,
): Promise<CaptainHandoffId | null> {
  const [row] = await db
    .select({ id: captainHandoff.id })
    .from(captainHandoff)
    .where(
      and(
        eq(captainHandoff.teamSeasonId, teamSeasonId),
        eq(captainHandoff.toUserId, userId),
        eq(captainHandoff.status, "pending"),
      ),
    );
  return row?.id ?? null;
}

/** Account deletion: offers to or from the person stop waiting. */
export async function cancelHandoffsFor(db: Db, userId: UserId, now: Date) {
  await db
    .update(captainHandoff)
    .set({ status: "cancelled", decidedAt: now })
    .where(
      and(
        eq(captainHandoff.status, "pending"),
        or(
          eq(captainHandoff.fromUserId, userId),
          eq(captainHandoff.toUserId, userId),
        ),
      ),
    );
}

/** For a person's own export: offers they made or were made. */
export async function myHandoffs(db: Db, userId: UserId) {
  const rows = await db
    .select({
      team: team.name,
      season: season.name,
      offeredBy: captainHandoff.fromUserId,
      offeredTo: captainHandoff.toUserId,
      status: captainHandoff.status,
      createdAt: captainHandoff.createdAt,
      decidedAt: captainHandoff.decidedAt,
    })
    .from(captainHandoff)
    .innerJoin(teamSeason, eq(captainHandoff.teamSeasonId, teamSeason.id))
    .innerJoin(team, eq(teamSeason.teamId, team.id))
    .innerJoin(season, eq(teamSeason.seasonId, season.id))
    .where(
      or(
        eq(captainHandoff.fromUserId, userId),
        eq(captainHandoff.toUserId, userId),
      ),
    )
    .orderBy(asc(captainHandoff.createdAt));
  return rows.map(({ offeredBy, offeredTo, ...r }) => ({
    ...r,
    youOffered: offeredBy === userId,
    offeredToYou: offeredTo === userId,
  }));
}
