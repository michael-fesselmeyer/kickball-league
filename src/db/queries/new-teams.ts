import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type {
  LeagueId,
  RegistrationId,
  SeasonId,
  TeamFormationRequestId,
  TeamId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { priceFor, registrationWindow } from "@/domain/registration/pricing";
import type { NewTeamRequestInput } from "@/domain/registration/new-team";
import { err, ok, type Result } from "@/domain/result";
import { slugify } from "@/domain/slug";
import type { NewTeamPayload } from "@/emails/new-team";
import { user } from "../schema/auth";
import { teamFormationRequest } from "../schema/formation";
import { purchase, purchaseItem } from "../schema/money";
import { profile } from "../schema/profile";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { recordAudit } from "./audit";
import { enqueueMessages, type OutboxMessage } from "./outbox";
import {
  type SeasonForRegistration,
  startingState,
  teamsEntered,
} from "./registration";
import { required } from "./rows";
import type { Db } from "./schedule";

/**
 * Start-a-new-team requests (docs/information-architecture.md, section 2.7).
 * A signed-in player asks; an admin approves or declines. Approval creates
 * the team in "forming" status with the requester as captain, moves them
 * off any team they were on (telling that captain), and the invite flow
 * takes over. Every answer reaches the requester through the outbox.
 */

/** "Sam E.", the way players see each other; the account name otherwise. */
const shortName = (
  first: string | null,
  last: string | null,
  fallback: string,
) => (first ? (last ? `${first} ${last.slice(0, 1)}.` : first) : fallback);

/** The person's registration this season and the team they are on, if any. */
async function currentSpot(db: Db, seasonId: SeasonId, userId: UserId) {
  const [found] = await db
    .select({
      registrationId: registration.id,
      kind: registration.kind,
      status: registration.status,
      membershipId: rosterMembership.id,
      role: rosterMembership.role,
      teamSeasonId: rosterMembership.teamSeasonId,
      teamName: team.name,
    })
    .from(registration)
    .leftJoin(
      rosterMembership,
      and(
        eq(rosterMembership.registrationId, registration.id),
        eq(rosterMembership.status, "active"),
      ),
    )
    .leftJoin(teamSeason, eq(rosterMembership.teamSeasonId, teamSeason.id))
    .leftJoin(team, eq(teamSeason.teamId, team.id))
    .where(
      and(
        eq(registration.seasonId, seasonId),
        eq(registration.userId, userId),
        sql`${registration.status} <> 'cancelled'`,
      ),
    );
  return found ?? null;
}

/** Registrations that paid for themselves (not covered by a captain's team fee). */
async function paidTheirOwnWay(
  db: Db,
  registrationIds: readonly RegistrationId[],
): Promise<Set<RegistrationId>> {
  if (registrationIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ id: purchaseItem.registrationId })
    .from(purchaseItem)
    .innerJoin(purchase, eq(purchaseItem.purchaseId, purchase.id))
    .where(
      and(
        inArray(purchaseItem.registrationId, [...registrationIds]),
        eq(purchase.status, "paid"),
      ),
    );
  return new Set(rows.flatMap((r) => (r.id ? [r.id] : [])));
}

/**
 * Where a would-be requester stands this season, for the request screen:
 * their team and role, and whether they paid for themselves.
 */
export async function requesterStanding(
  db: Db,
  seasonId: SeasonId,
  userId: UserId,
) {
  const spot = await currentSpot(db, seasonId, userId);
  if (!spot) return null;
  const own = await paidTheirOwnWay(db, [spot.registrationId]);
  return {
    team:
      spot.role && spot.teamName
        ? { name: spot.teamName, role: spot.role }
        : null,
    paidOwnWay: own.has(spot.registrationId),
  };
}

/** Whether `name` is a team in the league or another open request this season. */
async function nameTaken(
  db: Db,
  leagueId: LeagueId,
  seasonId: SeasonId,
  name: string,
  except: TeamFormationRequestId | null,
) {
  const slug = slugify(name);
  const [existing] = await db
    .select({ id: team.id })
    .from(team)
    .where(and(eq(team.leagueId, leagueId), eq(team.slug, slug)));
  if (existing) return true;
  const pending = await db
    .select({
      id: teamFormationRequest.id,
      name: teamFormationRequest.proposedName,
    })
    .from(teamFormationRequest)
    .where(
      and(
        eq(teamFormationRequest.seasonId, seasonId),
        eq(teamFormationRequest.status, "pending"),
      ),
    );
  return pending.some((p) => p.id !== except && slugify(p.name) === slug);
}

export type RequestError = "closed" | "captain" | "pending" | "name_taken";

/** A player asks the league to start a team this season. */
export async function requestNewTeam(
  db: Db,
  input: {
    leagueId: LeagueId;
    season: SeasonForRegistration;
    userId: UserId;
    request: NewTeamRequestInput;
    now: Date;
  },
): Promise<Result<TeamFormationRequestId, RequestError>> {
  const { season: s, userId, request: r, now } = input;
  if (registrationWindow(s, now) !== "open") return err("closed");
  const spot = await currentSpot(db, s.id, userId);
  if (spot?.role === "captain") return err("captain");
  if (await nameTaken(db, input.leagueId, s.id, r.name, null))
    return err("name_taken");
  // The partial unique index keeps one open request per person, even when
  // two arrive at once.
  const [created] = await db
    .insert(teamFormationRequest)
    .values({
      seasonId: s.id,
      requestedBy: userId,
      proposedName: r.name,
      expectedSize: r.expectedSize,
      paymentMode: r.paymentMode,
      note: r.note,
    })
    .onConflictDoNothing()
    .returning({ id: teamFormationRequest.id });
  if (!created) return err("pending");
  await recordAudit(db, {
    actorId: userId,
    action: "team.request_new",
    entityType: "team_formation_request",
    entityId: created.id,
    after: { seasonId: s.id, ...r },
  });
  return ok(created.id);
}

/** The requester takes back a request an admin has not answered yet. */
export async function withdrawNewTeamRequest(
  db: Db,
  input: { requestId: TeamFormationRequestId; userId: UserId },
): Promise<Result<void, "not_pending">> {
  const [withdrawn] = await db
    .update(teamFormationRequest)
    .set({ status: "withdrawn" })
    .where(
      and(
        eq(teamFormationRequest.id, input.requestId),
        eq(teamFormationRequest.requestedBy, input.userId),
        eq(teamFormationRequest.status, "pending"),
      ),
    )
    .returning({ id: teamFormationRequest.id });
  if (!withdrawn) return err("not_pending");
  await recordAudit(db, {
    actorId: input.userId,
    action: "team.withdraw_request",
    entityType: "team_formation_request",
    entityId: withdrawn.id,
    after: { status: "withdrawn" },
  });
  return ok(undefined);
}

/** The person's latest request this season, with the team it became. */
export async function myNewTeamRequest(
  db: Db,
  seasonId: SeasonId,
  userId: UserId,
) {
  const [latest] = await db
    .select({
      id: teamFormationRequest.id,
      proposedName: teamFormationRequest.proposedName,
      expectedSize: teamFormationRequest.expectedSize,
      paymentMode: teamFormationRequest.paymentMode,
      note: teamFormationRequest.note,
      status: teamFormationRequest.status,
      declineReason: teamFormationRequest.declineReason,
      createdAt: teamFormationRequest.createdAt,
      decidedAt: teamFormationRequest.decidedAt,
    })
    .from(teamFormationRequest)
    .where(
      and(
        eq(teamFormationRequest.seasonId, seasonId),
        eq(teamFormationRequest.requestedBy, userId),
      ),
    )
    .orderBy(desc(teamFormationRequest.createdAt))
    .limit(1);
  return latest ?? null;
}

export type MyNewTeamRequest = NonNullable<
  Awaited<ReturnType<typeof myNewTeamRequest>>
>;

/** How many requests wait for an admin, for the season's admin screen. */
export async function pendingNewTeamCount(db: Db, seasonId: SeasonId) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(teamFormationRequest)
    .where(
      and(
        eq(teamFormationRequest.seasonId, seasonId),
        eq(teamFormationRequest.status, "pending"),
      ),
    );
  return row?.n ?? 0;
}

export type AdminNewTeamRequest = {
  id: TeamFormationRequestId;
  proposedName: string;
  expectedSize: number;
  paymentMode: "full" | "split";
  note: string | null;
  status: "pending" | "approved" | "declined" | "withdrawn";
  declineReason: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  requester: { name: string; email: string };
  /** Where the requester stands this season, for an open request. */
  now: {
    registered: boolean;
    team: { name: string; role: "captain" | "co_captain" | "player" } | null;
    paid: boolean;
    paidOwnWay: boolean;
  } | null;
};

/**
 * Every request in the season for the admin screen: open ones first, oldest
 * first so nobody waits longest, then answered ones newest first. Four
 * queries whatever the number of requests.
 */
export async function newTeamRequestsBoard(
  db: Db,
  seasonId: SeasonId,
): Promise<AdminNewTeamRequest[]> {
  const rows = await db
    .select({
      id: teamFormationRequest.id,
      requestedBy: teamFormationRequest.requestedBy,
      proposedName: teamFormationRequest.proposedName,
      expectedSize: teamFormationRequest.expectedSize,
      paymentMode: teamFormationRequest.paymentMode,
      note: teamFormationRequest.note,
      status: teamFormationRequest.status,
      declineReason: teamFormationRequest.declineReason,
      createdAt: teamFormationRequest.createdAt,
      decidedAt: teamFormationRequest.decidedAt,
      firstName: profile.firstName,
      lastName: profile.lastName,
      accountName: user.name,
      email: user.email,
    })
    .from(teamFormationRequest)
    .innerJoin(user, eq(teamFormationRequest.requestedBy, user.id))
    .leftJoin(profile, eq(profile.userId, user.id))
    .where(eq(teamFormationRequest.seasonId, seasonId))
    .orderBy(asc(teamFormationRequest.createdAt));

  const openIds = rows
    .filter((r) => r.status === "pending")
    .map((r) => r.requestedBy);
  const spots =
    openIds.length === 0
      ? []
      : await db
          .select({
            userId: registration.userId,
            registrationId: registration.id,
            status: registration.status,
            role: rosterMembership.role,
            teamName: team.name,
          })
          .from(registration)
          .leftJoin(
            rosterMembership,
            and(
              eq(rosterMembership.registrationId, registration.id),
              eq(rosterMembership.status, "active"),
            ),
          )
          .leftJoin(
            teamSeason,
            eq(rosterMembership.teamSeasonId, teamSeason.id),
          )
          .leftJoin(team, eq(teamSeason.teamId, team.id))
          .where(
            and(
              eq(registration.seasonId, seasonId),
              inArray(registration.userId, openIds),
              sql`${registration.status} <> 'cancelled'`,
            ),
          );
  const ownWay = await paidTheirOwnWay(
    db,
    spots.map((s) => s.registrationId),
  );
  const spotOf = new Map(spots.map((s) => [s.userId, s]));

  const board = rows.map((r): AdminNewTeamRequest => {
    const spot = spotOf.get(r.requestedBy);
    return {
      id: r.id,
      proposedName: r.proposedName,
      expectedSize: r.expectedSize,
      paymentMode: r.paymentMode,
      note: r.note,
      status: r.status,
      declineReason: r.declineReason,
      createdAt: r.createdAt,
      decidedAt: r.decidedAt,
      requester: {
        name:
          r.firstName && r.lastName
            ? `${r.firstName} ${r.lastName}`
            : r.accountName || r.email,
        email: r.email,
      },
      now:
        r.status !== "pending"
          ? null
          : {
              registered: spot !== undefined,
              team:
                spot?.role && spot.teamName
                  ? { name: spot.teamName, role: spot.role }
                  : null,
              paid: spot?.status === "active",
              paidOwnWay: spot ? ownWay.has(spot.registrationId) : false,
            },
    };
  });
  const open = board.filter((r) => r.status === "pending");
  const answered = board
    .filter((r) => r.status !== "pending")
    .sort(
      (a, b) =>
        (b.decidedAt ?? b.createdAt).getTime() -
        (a.decidedAt ?? a.createdAt).getTime(),
    );
  return [...open, ...answered];
}

export type DecideError =
  | "not_found"
  | "not_pending"
  | "season_full"
  | "name_taken"
  | "captain"
  | "no_price";

/** The request, locked so two admins cannot answer it at once. */
async function lockPending(
  db: Db,
  seasonId: SeasonId,
  requestId: TeamFormationRequestId,
) {
  const [found] = await db
    .select()
    .from(teamFormationRequest)
    .where(
      and(
        eq(teamFormationRequest.id, requestId),
        eq(teamFormationRequest.seasonId, seasonId),
      ),
    )
    .for("update");
  if (!found) return err("not_found" as const);
  if (found.status !== "pending") return err("not_pending" as const);
  return ok(found);
}

const notice = (
  userId: UserId,
  dedupeKey: string,
  payload: NewTeamPayload,
  now: Date,
): OutboxMessage => ({
  userId,
  topic: "new_team",
  template: "new_team",
  payload,
  dedupeKey,
  sendAfter: now,
});

/**
 * Approves a request: creates the team in "forming" status with the
 * requester as captain, priced as of the day they asked (so a request made
 * in the early-bird window keeps its discount). A requester on another team
 * leaves it, and that team's captain is told. A requester who already paid
 * for themselves keeps that payment as their share, so their team splits the
 * fee; one whose spot was covered by their old captain's team fee owes again.
 */
export async function approveNewTeamRequest(
  db: Db,
  input: {
    leagueId: LeagueId;
    season: SeasonForRegistration;
    requestId: TeamFormationRequestId;
    actorId: UserId;
    now: Date;
  },
): Promise<Result<{ teamSeasonId: TeamSeasonId }, DecideError>> {
  const { season: s, actorId, now } = input;
  const locked = await lockPending(db, s.id, input.requestId);
  if (!locked.ok) return locked;
  const req = locked.value;
  if (s.maxTeams !== null && (await teamsEntered(db, s.id)) >= s.maxTeams)
    return err("season_full");
  if (await nameTaken(db, input.leagueId, s.id, req.proposedName, req.id))
    return err("name_taken");
  const spot = await currentSpot(db, s.id, req.requestedBy);
  if (spot?.role === "captain") return err("captain");
  const paidOwnWay = spot
    ? (await paidTheirOwnWay(db, [spot.registrationId])).has(
        spot.registrationId,
      )
    : false;
  const paymentMode =
    s.feeModel === "per_player" || (!paidOwnWay && req.paymentMode === "full")
      ? "full"
      : "split";
  const price = priceFor(
    s,
    { kind: "captain", paymentMode, rosterSize: req.expectedSize },
    req.createdAt,
  );
  if (!price.ok) return err("no_price");

  const [newTeam] = await db
    .insert(team)
    .values({
      leagueId: input.leagueId,
      name: req.proposedName,
      slug: slugify(req.proposedName),
      createdBy: actorId,
    })
    .returning({ id: team.id });
  const teamId: TeamId = required(newTeam, "team").id;
  const [entry] = await db
    .insert(teamSeason)
    .values({
      teamId,
      seasonId: s.id,
      status: "forming",
      paymentMode,
      shareCents: price.shareCents,
      targetRosterSize: req.expectedSize,
      createdBy: actorId,
    })
    .returning({ id: teamSeason.id });
  const teamSeasonId = required(entry, "team season").id;

  let registrationId: RegistrationId;
  if (spot) {
    registrationId = spot.registrationId;
    await db
      .update(registration)
      .set({
        kind: "team_member",
        // Covered by the old team's fee, not by their own payment: they owe again.
        ...(spot.status === "active" && !paidOwnWay
          ? { status: "pending_payment" as const }
          : {}),
      })
      .where(eq(registration.id, registrationId));
  } else {
    const [own] = await db
      .insert(registration)
      .values({
        seasonId: s.id,
        userId: req.requestedBy,
        kind: "team_member",
        ...(await startingState(db, s, req.requestedBy)),
        createdBy: actorId,
      })
      .returning({ id: registration.id });
    registrationId = required(own, "registration").id;
  }
  const left =
    spot?.membershipId && spot.teamSeasonId && spot.teamName
      ? {
          membershipId: spot.membershipId,
          teamSeasonId: spot.teamSeasonId,
          teamName: spot.teamName,
        }
      : null;
  if (left)
    await db
      .update(rosterMembership)
      .set({ status: "removed", endedAt: now })
      .where(eq(rosterMembership.id, left.membershipId));
  await db.insert(rosterMembership).values({
    teamSeasonId,
    registrationId,
    role: "captain",
    status: "active",
    startedAt: now,
    createdBy: actorId,
  });
  await db
    .update(teamFormationRequest)
    .set({
      status: "approved",
      decidedBy: actorId,
      decidedAt: now,
      teamSeasonId,
      leftTeamSeasonId: left?.teamSeasonId ?? null,
    })
    .where(eq(teamFormationRequest.id, req.id));
  await recordAudit(db, {
    actorId,
    action: "team.approve_new",
    entityType: "team_formation_request",
    entityId: req.id,
    before: { status: "pending" },
    after: {
      status: "approved",
      teamSeasonId,
      leftTeamSeasonId: left?.teamSeasonId ?? null,
      paymentMode,
      shareCents: price.shareCents,
    },
  });

  const about = {
    seasonName: s.name,
    seasonSlug: s.slug,
    team: req.proposedName,
  };
  const messages = [
    notice(
      req.requestedBy,
      `new_team:${req.id}:approved`,
      { ...about, kind: "approved" },
      now,
    ),
  ];
  if (left) {
    const [captain] = await db
      .select({ userId: registration.userId })
      .from(rosterMembership)
      .innerJoin(
        registration,
        eq(rosterMembership.registrationId, registration.id),
      )
      .where(
        and(
          eq(rosterMembership.teamSeasonId, left.teamSeasonId),
          eq(rosterMembership.role, "captain"),
          eq(rosterMembership.status, "active"),
        ),
      );
    const [who] = await db
      .select({
        first: profile.firstName,
        last: profile.lastName,
        name: user.name,
      })
      .from(user)
      .leftJoin(profile, eq(profile.userId, user.id))
      .where(eq(user.id, req.requestedBy));
    if (captain)
      messages.push(
        notice(
          captain.userId,
          `new_team:${req.id}:left:${captain.userId}`,
          {
            ...about,
            kind: "player_left",
            player: shortName(
              who?.first ?? null,
              who?.last ?? null,
              who?.name || "A player",
            ),
            leftTeam: left.teamName,
          },
          now,
        ),
      );
  }
  await enqueueMessages(db, messages);
  return ok({ teamSeasonId });
}

/** Declines a request, with an optional reason the requester sees. */
export async function declineNewTeamRequest(
  db: Db,
  input: {
    season: { id: SeasonId; name: string; slug: string };
    requestId: TeamFormationRequestId;
    actorId: UserId;
    reason: string | null;
    now: Date;
  },
): Promise<Result<void, DecideError>> {
  const { season: s, actorId, now } = input;
  const locked = await lockPending(db, s.id, input.requestId);
  if (!locked.ok) return locked;
  const req = locked.value;
  await db
    .update(teamFormationRequest)
    .set({
      status: "declined",
      decidedBy: actorId,
      decidedAt: now,
      declineReason: input.reason,
    })
    .where(eq(teamFormationRequest.id, req.id));
  await recordAudit(db, {
    actorId,
    action: "team.decline_new",
    entityType: "team_formation_request",
    entityId: req.id,
    before: { status: "pending" },
    after: { status: "declined", reason: input.reason },
  });
  await enqueueMessages(db, [
    notice(
      req.requestedBy,
      `new_team:${req.id}:declined`,
      {
        seasonName: s.name,
        seasonSlug: s.slug,
        team: req.proposedName,
        kind: "declined",
        reason: input.reason,
      },
      now,
    ),
  ]);
  return ok(undefined);
}
