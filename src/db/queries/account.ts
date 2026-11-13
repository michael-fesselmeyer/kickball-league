import { and, asc, count, eq, gt, inArray, ne, sql } from "drizzle-orm";
import type { UserId } from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import { auditLog } from "../schema/audit";
import { awardPoll, awardVote } from "../schema/awards";
import { freeAgentProfile } from "../schema/free-agent";
import { account, session, user, verification } from "../schema/auth";
import { eventRsvp } from "../schema/event";
import {
  gameRsvp,
  refereeAssignment,
  scoreReport,
  scoreResponse,
} from "../schema/game";
import {
  announcement,
  message,
  notificationPreference,
} from "../schema/message";
import { payment, purchase, purchaseItem } from "../schema/money";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { teamFormationRequest } from "../schema/formation";
import { subClaim, subRequest } from "../schema/subs";
import {
  invite,
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { waiver, waiverSignature } from "../schema/waiver";
import { recordAudit } from "./audit";
import { leaveEvent } from "./events";
import { withdrawSubClaim } from "./subs";
import type { Db } from "./schedule";

/**
 * A person's control over their own data (product-spec.md, section 6:
 * "Account deletion and data export on request"; docs/data-model.md,
 * section 4). The export is everything the league holds about them; the
 * delete anonymizes them so league records stay intact.
 */

/** The name an anonymized account shows on old rosters and records. */
export const DELETED_NAME = "Deleted account";

/** An address that cannot receive mail (RFC 2606) and is unique per account. */
export const deletedEmail = (userId: UserId) =>
  `deleted-${userId}@deleted.invalid`;

/** A copy of `row` without an internal key. */
function without<Row extends object, Key extends keyof Row>(
  row: Row,
  key: Key,
): Omit<Row, Key> {
  const copy = { ...row };
  delete copy[key];
  return copy;
}

/**
 * Everything the league holds about one person, as plain JSON. Secrets are
 * never included: no session tokens, sign-in tokens or provider tokens.
 */
export async function personalData(db: Db, userId: UserId, now: Date) {
  const [person] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(eq(user.id, userId));
  if (!person) return null;

  const [me] = await db
    .select({
      firstName: profile.firstName,
      lastName: profile.lastName,
      phone: profile.phoneE164,
      phoneVerifiedAt: profile.phoneVerifiedAt,
      gender: profile.gender,
      lineupGender: profile.lineupGender,
      shirtSize: profile.shirtSize,
      birthDate: profile.birthDate,
      emergencyContactName: profile.emergencyContactName,
      emergencyContactPhone: profile.emergencyContactPhone,
      role: profile.globalRole,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    })
    .from(profile)
    .where(eq(profile.userId, userId));

  const signInMethods = await db
    .select({ provider: account.providerId, linkedAt: account.createdAt })
    .from(account)
    .where(eq(account.userId, userId))
    .orderBy(asc(account.createdAt));

  const sessions = await db
    .select({
      signedInAt: session.createdAt,
      expiresAt: session.expiresAt,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
    })
    .from(session)
    .where(eq(session.userId, userId))
    .orderBy(asc(session.createdAt));

  const registrations = await db
    .select({
      id: registration.id,
      season: season.name,
      kind: registration.kind,
      status: registration.status,
      shirtStatus: registration.shirtStatus,
      registeredAt: registration.createdAt,
    })
    .from(registration)
    .innerJoin(season, eq(registration.seasonId, season.id))
    .where(eq(registration.userId, userId))
    .orderBy(asc(registration.createdAt));
  const memberships = registrations.length
    ? await db
        .select({
          registrationId: rosterMembership.registrationId,
          team: team.name,
          role: rosterMembership.role,
          status: rosterMembership.status,
          startedAt: rosterMembership.startedAt,
          endedAt: rosterMembership.endedAt,
          sharesContactWithTeam: rosterMembership.sharesContact,
        })
        .from(rosterMembership)
        .innerJoin(teamSeason, eq(rosterMembership.teamSeasonId, teamSeason.id))
        .innerJoin(team, eq(teamSeason.teamId, team.id))
        .where(
          inArray(
            rosterMembership.registrationId,
            registrations.map((r) => r.id),
          ),
        )
        .orderBy(asc(rosterMembership.createdAt))
    : [];
  const quizzes = registrations.length
    ? await db
        .select({
          registrationId: freeAgentProfile.registrationId,
          answers: freeAgentProfile.answers,
          notes: freeAgentProfile.notes,
          answeredAt: freeAgentProfile.updatedAt,
        })
        .from(freeAgentProfile)
        .where(
          inArray(
            freeAgentProfile.registrationId,
            registrations.map((r) => r.id),
          ),
        )
    : [];

  const waivers = await db
    .select({
      waiver: waiver.title,
      version: waiver.version,
      season: season.name,
      signedName: waiverSignature.signedName,
      signedAt: waiverSignature.signedAt,
      ipAddress: waiverSignature.ip,
      userAgent: waiverSignature.userAgent,
    })
    .from(waiverSignature)
    .innerJoin(waiver, eq(waiverSignature.waiverId, waiver.id))
    .innerJoin(season, eq(waiverSignature.seasonId, season.id))
    .where(eq(waiverSignature.userId, userId))
    .orderBy(asc(waiverSignature.signedAt));

  const purchases = await db
    .select({
      id: purchase.id,
      season: season.name,
      status: purchase.status,
      subtotalCents: purchase.subtotalCents,
      discountCents: purchase.discountCents,
      creditAppliedCents: purchase.creditAppliedCents,
      totalCents: purchase.totalCents,
      createdAt: purchase.createdAt,
    })
    .from(purchase)
    .leftJoin(season, eq(purchase.seasonId, season.id))
    .where(eq(purchase.userId, userId))
    .orderBy(asc(purchase.createdAt));
  const purchaseIds = purchases.map((p) => p.id);
  const items = purchaseIds.length
    ? await db
        .select({
          purchaseId: purchaseItem.purchaseId,
          kind: purchaseItem.kind,
          description: purchaseItem.description,
          amountCents: purchaseItem.amountCents,
        })
        .from(purchaseItem)
        .where(inArray(purchaseItem.purchaseId, purchaseIds))
    : [];
  const payments = purchaseIds.length
    ? await db
        .select({
          purchaseId: payment.purchaseId,
          method: payment.method,
          amountCents: payment.amountCents,
          status: payment.status,
          note: payment.note,
          paidAt: payment.paidAt,
        })
        .from(payment)
        .where(inArray(payment.purchaseId, purchaseIds))
        .orderBy(asc(payment.createdAt))
    : [];

  const rsvps = await db
    .select({
      gameId: gameRsvp.gameId,
      status: gameRsvp.status,
      updatedAt: gameRsvp.updatedAt,
    })
    .from(gameRsvp)
    .where(eq(gameRsvp.userId, userId))
    .orderBy(asc(gameRsvp.updatedAt));
  const eventRsvps = await db
    .select({
      eventId: eventRsvp.eventId,
      status: eventRsvp.status,
      createdAt: eventRsvp.createdAt,
    })
    .from(eventRsvp)
    .where(eq(eventRsvp.userId, userId))
    .orderBy(asc(eventRsvp.createdAt));
  const scoresReported = await db
    .select({
      gameId: scoreReport.gameId,
      scoreA: scoreReport.scoreA,
      scoreB: scoreReport.scoreB,
      outcome: scoreReport.outcome,
      reportedAt: scoreReport.reportedAt,
    })
    .from(scoreReport)
    .where(eq(scoreReport.reportedBy, userId))
    .orderBy(asc(scoreReport.reportedAt));
  const scoreAnswers = await db
    .select({
      status: scoreResponse.status,
      note: scoreResponse.note,
      respondedAt: scoreResponse.respondedAt,
    })
    .from(scoreResponse)
    .where(eq(scoreResponse.userId, userId))
    .orderBy(asc(scoreResponse.respondedAt));
  const refereeing = await db
    .select({
      gameId: refereeAssignment.gameId,
      status: refereeAssignment.status,
      feeCents: refereeAssignment.feeCents,
    })
    .from(refereeAssignment)
    .where(eq(refereeAssignment.userId, userId))
    .orderBy(asc(refereeAssignment.offeredAt));

  const subClaims = await db
    .select({
      gameId: subRequest.gameId,
      status: subClaim.status,
      lineupGender: subClaim.lineupGender,
      claimedAt: subClaim.claimedAt,
      decidedAt: subClaim.decidedAt,
    })
    .from(subClaim)
    .innerJoin(subRequest, eq(subClaim.subRequestId, subRequest.id))
    .where(eq(subClaim.userId, userId))
    .orderBy(asc(subClaim.claimedAt));
  // Their own ballots: the poll and whom they picked, a person or a team.
  const awardVotes = await db
    .select({
      poll: awardPoll.title,
      castAt: awardVote.castAt,
      pickedPlayer: sql<
        string | null
      >`(select concat_ws(' ', ${profile.firstName}, left(${profile.lastName}, 1) || '.') from ${profile} where ${profile.userId} = ${awardVote.nomineeUserId})`,
      pickedTeam: sql<
        string | null
      >`(select ${team.name} from ${teamSeason} join ${team} on ${team.id} = ${teamSeason.teamId} where ${teamSeason.id} = ${awardVote.nomineeTeamSeasonId})`,
    })
    .from(awardVote)
    .innerJoin(awardPoll, eq(awardVote.awardPollId, awardPoll.id))
    .where(eq(awardVote.voterId, userId))
    .orderBy(asc(awardVote.castAt));
  const subRequestsPosted = await db
    .select({
      gameId: subRequest.gameId,
      needed: subRequest.needed,
      note: subRequest.note,
      status: subRequest.status,
      createdAt: subRequest.createdAt,
    })
    .from(subRequest)
    .where(eq(subRequest.requestedBy, userId))
    .orderBy(asc(subRequest.createdAt));

  const newTeamRequests = await db
    .select({
      seasonId: teamFormationRequest.seasonId,
      proposedName: teamFormationRequest.proposedName,
      expectedSize: teamFormationRequest.expectedSize,
      note: teamFormationRequest.note,
      status: teamFormationRequest.status,
      declineReason: teamFormationRequest.declineReason,
      createdAt: teamFormationRequest.createdAt,
      decidedAt: teamFormationRequest.decidedAt,
    })
    .from(teamFormationRequest)
    .where(eq(teamFormationRequest.requestedBy, userId))
    .orderBy(asc(teamFormationRequest.createdAt));

  const emailSettings = await db
    .select({
      topic: notificationPreference.topic,
      channel: notificationPreference.channel,
      enabled: notificationPreference.enabled,
    })
    .from(notificationPreference)
    .where(eq(notificationPreference.userId, userId))
    .orderBy(asc(notificationPreference.topic));
  const messages = await db
    .select({
      topic: message.topic,
      channel: message.channel,
      template: message.template,
      content: message.payload,
      status: message.status,
      createdAt: message.createdAt,
      sentAt: message.sentAt,
    })
    .from(message)
    .where(eq(message.userId, userId))
    .orderBy(asc(message.createdAt));
  const announcementsSent = await db
    .select({
      subject: announcement.subject,
      body: announcement.body,
      recipients: announcement.recipientCount,
      sentAt: announcement.createdAt,
    })
    .from(announcement)
    .where(eq(announcement.authorId, userId))
    .orderBy(asc(announcement.createdAt));
  const actionsTaken = await db
    .select({
      action: auditLog.action,
      entityType: auditLog.entityType,
      occurredAt: auditLog.occurredAt,
    })
    .from(auditLog)
    .where(eq(auditLog.actorId, userId))
    .orderBy(asc(auditLog.occurredAt));

  return {
    exportedAt: now.toISOString(),
    account: {
      name: person.name,
      email: person.email,
      emailVerified: person.emailVerified,
      createdAt: person.createdAt,
    },
    profile: me ?? null,
    signInMethods,
    sessions,
    registrations: registrations.map((r) => ({
      ...without(r, "id"),
      teams: memberships
        .filter((m) => m.registrationId === r.id)
        .map((m) => without(m, "registrationId")),
      freeAgentQuiz: ((q) => (q ? without(q, "registrationId") : null))(
        quizzes.find((q) => q.registrationId === r.id),
      ),
    })),
    waiverSignatures: waivers,
    purchases: purchases.map((p) => ({
      ...without(p, "id"),
      items: items
        .filter((i) => i.purchaseId === p.id)
        .map((i) => without(i, "purchaseId")),
      payments: payments
        .filter((x) => x.purchaseId === p.id)
        .map((x) => without(x, "purchaseId")),
    })),
    rsvps,
    eventRsvps,
    scoresReported,
    scoreAnswers,
    refereeAssignments: refereeing,
    subClaims,
    subRequestsPosted,
    newTeamRequests,
    awardVotes: awardVotes.map((v) => ({
      poll: v.poll,
      castAt: v.castAt,
      pick: v.pickedPlayer ?? v.pickedTeam,
    })),
    emailSettings,
    messages,
    announcementsSent,
    actionsTaken,
  };
}

export type PersonalData = NonNullable<
  Awaited<ReturnType<typeof personalData>>
>;

export type DeleteBlocker =
  | { reason: "captain"; team: string; season: string }
  | { reason: "last_owner" };

/**
 * What stops a person deleting their account now: captaining a team in a
 * season that is not over (the team would have no captain), or being the
 * league's only owner. Null when nothing does.
 */
export async function deleteBlocker(
  db: Db,
  userId: UserId,
): Promise<DeleteBlocker | null> {
  const [captaincy] = await db
    .select({ team: team.name, season: season.name })
    .from(rosterMembership)
    .innerJoin(
      registration,
      eq(rosterMembership.registrationId, registration.id),
    )
    .innerJoin(teamSeason, eq(rosterMembership.teamSeasonId, teamSeason.id))
    .innerJoin(team, eq(teamSeason.teamId, team.id))
    .innerJoin(season, eq(teamSeason.seasonId, season.id))
    .where(
      and(
        eq(registration.userId, userId),
        eq(rosterMembership.role, "captain"),
        eq(rosterMembership.status, "active"),
        ne(teamSeason.status, "withdrawn"),
        ne(season.status, "completed"),
      ),
    )
    .limit(1);
  if (captaincy) return { reason: "captain", ...captaincy };

  const [me] = await db
    .select({ role: profile.globalRole })
    .from(profile)
    .where(eq(profile.userId, userId));
  if (me?.role === "owner") {
    const [owners] = await db
      .select({ n: count() })
      .from(profile)
      .where(eq(profile.globalRole, "owner"));
    if ((owners?.n ?? 0) <= 1) return { reason: "last_owner" };
  }
  return null;
}

export type DeleteError = "not_found" | DeleteBlocker["reason"];

/**
 * Deletes a person's account by anonymizing it (docs/data-model.md,
 * section 4). Call it inside a transaction.
 *
 * Removed: the profile (name, phone, gender, shirt size, birth date,
 * emergency contact), every session and sign-in method, pending sign-in
 * links, game and event RSVPs (a freed event spot goes to the waitlist),
 * email settings and messages, and their address on invites.
 * Sub claims for games still to come are withdrawn, which reopens the spot
 * and tells the captains; past claims stay as history without the copied
 * lineup gender.
 * Votes in awards polls still open are withdrawn; closed polls keep their
 * totals.
 * The user row stays, renamed and with an address that cannot receive
 * mail, so registrations, rosters, scores, payments, waiver signatures and
 * the audit log keep pointing at it.
 */
export async function deleteAccount(
  db: Db,
  userId: UserId,
  now: Date,
): Promise<Result<void, DeleteError>> {
  const [person] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, userId));
  if (!person) return err("not_found");
  const blocker = await deleteBlocker(db, userId);
  if (blocker) return err(blocker.reason);

  // Withdraw live claims first, while the captains' notice can still name
  // the player.
  const live = await db
    .select({ requestId: subClaim.subRequestId })
    .from(subClaim)
    .innerJoin(subRequest, eq(subClaim.subRequestId, subRequest.id))
    .where(
      and(
        eq(subClaim.userId, userId),
        inArray(subClaim.status, ["pending", "approved"]),
        ne(subRequest.status, "cancelled"),
        gt(subRequest.closesAt, now),
      ),
    );
  for (const { requestId } of live)
    await withdrawSubClaim(db, { requestId, userId, now });
  await db
    .update(subClaim)
    .set({ lineupGender: null })
    .where(eq(subClaim.userId, userId));

  // An open request to start a team cannot be approved for a deleted account.
  await db
    .update(teamFormationRequest)
    .set({ status: "withdrawn" })
    .where(
      and(
        eq(teamFormationRequest.requestedBy, userId),
        eq(teamFormationRequest.status, "pending"),
      ),
    );

  await db.delete(session).where(eq(session.userId, userId));
  await db.delete(account).where(eq(account.userId, userId));
  // Unused sign-in links name the address in their stored value.
  await db
    .delete(verification)
    .where(
      sql`position(${`"email":${JSON.stringify(person.email)}`} in ${verification.value}) > 0`,
    );
  await db.delete(gameRsvp).where(eq(gameRsvp.userId, userId));
  // Give up event spots the way the person would, so the waitlist moves up;
  // RSVPs for past or called-off events are simply removed.
  const rsvpd = await db
    .select({ eventId: eventRsvp.eventId })
    .from(eventRsvp)
    .where(eq(eventRsvp.userId, userId));
  for (const { eventId } of rsvpd)
    await leaveEvent(db, { eventId, userId, now });
  await db.delete(eventRsvp).where(eq(eventRsvp.userId, userId));
  // Votes in polls still open come out of the count; closed totals stay.
  await db
    .delete(awardVote)
    .where(
      and(
        eq(awardVote.voterId, userId),
        inArray(
          awardVote.awardPollId,
          db
            .select({ id: awardPoll.id })
            .from(awardPoll)
            .where(gt(awardPoll.closesAt, now)),
        ),
      ),
    );
  await db
    .delete(notificationPreference)
    .where(eq(notificationPreference.userId, userId));
  await db.delete(message).where(eq(message.userId, userId));
  await db
    .update(invite)
    .set({ status: "revoked" })
    .where(
      and(
        sql`lower(${invite.email}) = lower(${person.email})`,
        eq(invite.status, "open"),
      ),
    );
  await db
    .update(invite)
    .set({ email: null })
    .where(sql`lower(${invite.email}) = lower(${person.email})`);
  const mine = db
    .select({ id: registration.id })
    .from(registration)
    .where(eq(registration.userId, userId));
  await db
    .update(rosterMembership)
    .set({ sharesContact: false })
    .where(inArray(rosterMembership.registrationId, mine));
  await db
    .delete(freeAgentProfile)
    .where(inArray(freeAgentProfile.registrationId, mine));
  await db
    .update(registration)
    .set({ friendGroupId: null })
    .where(eq(registration.userId, userId));
  await db.delete(profile).where(eq(profile.userId, userId));
  await db
    .update(user)
    .set({
      name: DELETED_NAME,
      email: deletedEmail(userId),
      emailVerified: false,
      image: null,
    })
    .where(eq(user.id, userId));
  // The audit row names no personal data: only that the account was anonymized.
  await recordAudit(db, {
    actorId: userId,
    action: "account.delete",
    entityType: "user",
    entityId: userId,
    after: { anonymized: true },
  });
  return ok(undefined);
}
