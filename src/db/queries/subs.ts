import {
  and,
  asc,
  eq,
  gt,
  inArray,
  lt,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type {
  GameId,
  SeasonId,
  SubClaimId,
  SubRequestId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { wantsEmail } from "@/domain/notifications/topics";
import { err, ok, type Result } from "@/domain/result";
import {
  canPostFor,
  checkEligibility,
  describeSpots,
  type Held,
  hasSpotFor,
  type Ineligible,
  isFreeAgent,
  type LineupGender,
  NOBODY,
  openSpots,
  type PostBlock,
  type Spots,
  type SubCandidate,
  type SubGame,
} from "@/domain/subs/eligibility";
import type { SubRequestPayload, SubUpdatePayload } from "@/emails/sub-request";
import { user } from "../schema/auth";
import { field, game, refereeAssignment, slot } from "../schema/game";
import { league } from "../schema/league";
import { notificationPreference } from "../schema/message";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { subClaim, subRequest } from "../schema/subs";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { suspendedAmong } from "./discipline";
import { enqueueMessages, type OutboxMessage } from "./outbox";
import type { Db } from "./schedule";

/**
 * The sub finder (product-spec.md, "Sub finder"; information-architecture.md,
 * section 2.6). A captain posts a request for a game; eligible players hear
 * about it through the outbox; a player's claim holds a spot until the
 * captain approves or declines it; the opposing captain and the ref see the
 * approved pickups.
 *
 * Every change that touches spots runs in a transaction that first locks
 * the request row, so two players claiming the last spot at once are
 * served one after the other and only one gets it.
 */

/** Open requests a team may have at once (architecture.md, "Rate limits"). */
export const MAX_OPEN_PER_TEAM = 3;

export type SubGameInfo = SubGame & {
  id: GameId;
  seasonId: SeasonId;
  seasonName: string;
  seasonSlug: string;
  teamNames: readonly [string, string];
  /** "Sun, Sep 13, 7:00 PM, Field 2", in the league's time zone. */
  when: string;
};

/** A game as the sub finder needs it, or null if there is no such game. */
export async function subGame(
  db: Db,
  gameId: GameId,
): Promise<SubGameInfo | null> {
  const [row] = await db
    .select({
      id: game.id,
      kind: game.kind,
      status: game.status,
      teamAId: game.teamAId,
      teamBId: game.teamBId,
      seasonId: game.seasonId,
      seasonName: season.name,
      seasonSlug: season.slug,
      timeZone: league.timezone,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      fieldName: field.name,
    })
    .from(game)
    .innerJoin(season, eq(game.seasonId, season.id))
    .innerJoin(league, eq(season.leagueId, league.id))
    .leftJoin(slot, eq(game.slotId, slot.id))
    .leftJoin(field, eq(slot.fieldId, field.id))
    .where(eq(game.id, gameId));
  if (!row) return null;
  const names = await db
    .select({ id: teamSeason.id, name: team.name })
    .from(teamSeason)
    .innerJoin(team, eq(teamSeason.teamId, team.id))
    .where(inArray(teamSeason.id, [row.teamAId, row.teamBId]));
  const nameOf = (id: TeamSeasonId) =>
    names.find((n) => n.id === id)?.name ?? "TBD";
  const when = row.startsAt
    ? `${new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: row.timeZone,
      }).format(row.startsAt)}${row.fieldName ? `, ${row.fieldName}` : ""}`
    : "time to be set";
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    teamSeasonIds: [row.teamAId, row.teamBId],
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    seasonId: row.seasonId,
    seasonName: row.seasonName,
    seasonSlug: row.seasonSlug,
    teamNames: [nameOf(row.teamAId), nameOf(row.teamBId)],
    when,
  };
}

type Candidate = SubCandidate & { userId: UserId };

/**
 * Everyone registered for the game's season, as sub candidates: their
 * registration, team and lineup gender, and the other games they play or
 * referee that overlap this one. Pass `only` for one person.
 */
async function candidatesFor(
  db: Db,
  g: SubGameInfo,
  only?: UserId,
): Promise<Candidate[]> {
  const people = await db
    .select({
      userId: registration.userId,
      registrationId: registration.id,
      kind: registration.kind,
      status: registration.status,
      lineupGender: profile.lineupGender,
    })
    .from(registration)
    .leftJoin(profile, eq(profile.userId, registration.userId))
    .where(
      and(
        eq(registration.seasonId, g.seasonId),
        only ? eq(registration.userId, only) : undefined,
      ),
    );
  if (people.length === 0) return [];
  const rosters = await db
    .select({
      registrationId: rosterMembership.registrationId,
      teamSeasonId: rosterMembership.teamSeasonId,
    })
    .from(rosterMembership)
    .where(
      and(
        inArray(
          rosterMembership.registrationId,
          people.map((p) => p.registrationId),
        ),
        eq(rosterMembership.status, "active"),
      ),
    );
  const teamOf = new Map(
    rosters.map((r) => [r.registrationId, r.teamSeasonId]),
  );

  // Other games at an overlapping time, which keep their players and ref busy.
  const { startsAt, endsAt } = g;
  const clashes =
    startsAt && endsAt
      ? await db
          .select({
            id: game.id,
            teamAId: game.teamAId,
            teamBId: game.teamBId,
            startsAt: slot.startsAt,
            endsAt: slot.endsAt,
          })
          .from(game)
          .innerJoin(slot, eq(game.slotId, slot.id))
          .where(
            and(
              eq(game.seasonId, g.seasonId),
              notInArray(game.status, ["cancelled", "postponed"]),
              lt(slot.startsAt, endsAt),
              gt(slot.endsAt, startsAt),
            ),
          )
      : [];
  const refereeing =
    clashes.length === 0
      ? []
      : await db
          .select({
            gameId: refereeAssignment.gameId,
            userId: refereeAssignment.userId,
          })
          .from(refereeAssignment)
          .where(
            and(
              inArray(
                refereeAssignment.gameId,
                clashes.map((c) => c.id),
              ),
              eq(refereeAssignment.status, "accepted"),
            ),
          );

  // Suspended players can't take a spot, and aren't told about requests.
  const suspended = await suspendedAmong(
    db,
    people.map((p) => p.userId),
    new Date(),
  );

  return people.map((p) => {
    const teamSeasonId = teamOf.get(p.registrationId) ?? null;
    const commitments = clashes
      .filter(
        (c) =>
          (c.id !== g.id &&
            teamSeasonId !== null &&
            (c.teamAId === teamSeasonId || c.teamBId === teamSeasonId)) ||
          refereeing.some((r) => r.gameId === c.id && r.userId === p.userId),
      )
      .map((c) => ({ startsAt: c.startsAt, endsAt: c.endsAt }));
    return {
      userId: p.userId,
      registration: { kind: p.kind, status: p.status },
      teamSeasonId,
      lineupGender: p.lineupGender,
      commitments,
      suspended: suspended.has(p.userId),
    };
  });
}

/** The claims that hold a spot (pending or approved), by lineup gender. */
async function heldOn(db: Db, requestId: SubRequestId): Promise<Held> {
  const rows = await db
    .select({ lineupGender: subClaim.lineupGender })
    .from(subClaim)
    .where(
      and(
        eq(subClaim.subRequestId, requestId),
        inArray(subClaim.status, ["pending", "approved"]),
      ),
    );
  return {
    women: rows.filter((r) => r.lineupGender === "woman").length,
    men: rows.filter((r) => r.lineupGender === "man").length,
    unknown: rows.filter((r) => r.lineupGender === null).length,
  };
}

/** The active captain and co-captains of a team, who answer claims. */
async function captainsOf(db: Db, teamSeasonId: TeamSeasonId) {
  const rows = await db
    .select({ userId: registration.userId })
    .from(rosterMembership)
    .innerJoin(
      registration,
      eq(rosterMembership.registrationId, registration.id),
    )
    .where(
      and(
        eq(rosterMembership.teamSeasonId, teamSeasonId),
        eq(rosterMembership.status, "active"),
        inArray(rosterMembership.role, ["captain", "co_captain"]),
      ),
    );
  return rows.map((r) => r.userId);
}

/** "Jo S.": first name and last initial, as on public rosters. */
const shortName = sql<string>`coalesce(${profile.firstName} || coalesce(' ' || left(${profile.lastName}, 1) || '.', ''), nullif(${user.name}, ''), 'A player')`;

async function nameOf(db: Db, userId: UserId): Promise<string> {
  const [row] = await db
    .select({ name: shortName })
    .from(user)
    .leftJoin(profile, eq(profile.userId, user.id))
    .where(eq(user.id, userId));
  return row?.name ?? "A player";
}

const aboutGame = (g: SubGameInfo, teamSeasonId: TeamSeasonId) => ({
  seasonName: g.seasonName,
  seasonSlug: g.seasonSlug,
  team: g.teamSeasonIds[0] === teamSeasonId ? g.teamNames[0] : g.teamNames[1],
  teams: `${g.teamNames[0]} vs ${g.teamNames[1]}`,
  when: g.when,
});

const update = (
  userId: UserId,
  dedupeKey: string,
  payload: SubUpdatePayload,
  now: Date,
): OutboxMessage => ({
  userId,
  topic: "sub_request",
  template: "sub_update",
  payload,
  dedupeKey,
  sendAfter: now,
});

export type PostError =
  | PostBlock
  | "not_your_game"
  | "invalid_spots"
  | "already_posted"
  | "too_many_open";

/**
 * Posts a request and queues a notice to every eligible player who has sub
 * alerts on and could take one of its spots, free agents first. Returns the
 * request and how many were told.
 */
export async function postSubRequest(
  db: Db,
  input: {
    gameId: GameId;
    teamSeasonId: TeamSeasonId;
    requestedBy: UserId;
    spots: Spots;
    note: string | null;
    now: Date;
  },
): Promise<Result<{ id: SubRequestId; notified: number }, PostError>> {
  const { spots, now } = input;
  if (
    !Number.isInteger(spots.needed) ||
    spots.needed < 1 ||
    spots.needed > 11 ||
    spots.womenNeeded < 0 ||
    spots.menNeeded < 0 ||
    spots.womenNeeded + spots.menNeeded > spots.needed
  )
    return err("invalid_spots");
  return db.transaction(async (tx) => {
    // One poster per team at a time, so the open-request limit holds.
    await tx
      .select({ id: teamSeason.id })
      .from(teamSeason)
      .where(eq(teamSeason.id, input.teamSeasonId))
      .for("update");
    const g = await subGame(tx, input.gameId);
    if (!g || !g.teamSeasonIds.includes(input.teamSeasonId))
      return err("not_your_game");
    const allowed = canPostFor(g, now);
    if (!allowed.ok) return allowed;
    const live = await tx
      .select({ gameId: subRequest.gameId })
      .from(subRequest)
      .where(
        and(
          eq(subRequest.teamSeasonId, input.teamSeasonId),
          inArray(subRequest.status, ["open", "filled"]),
          gt(subRequest.closesAt, now),
        ),
      );
    if (live.some((r) => r.gameId === input.gameId))
      return err("already_posted");
    if (live.length >= MAX_OPEN_PER_TEAM) return err("too_many_open");
    // A request left over from a game that has started no longer counts.
    await tx
      .update(subRequest)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(subRequest.gameId, input.gameId),
          eq(subRequest.teamSeasonId, input.teamSeasonId),
          inArray(subRequest.status, ["open", "filled"]),
        ),
      );
    const [created] = await tx
      .insert(subRequest)
      .values({
        gameId: input.gameId,
        teamSeasonId: input.teamSeasonId,
        requestedBy: input.requestedBy,
        needed: spots.needed,
        womenNeeded: spots.womenNeeded,
        menNeeded: spots.menNeeded,
        note: input.note,
        closesAt: allowed.value.closesAt,
      })
      .returning({ id: subRequest.id });
    if (!created) throw new Error("Expected a sub request row");

    const reachable = (await candidatesFor(tx, g)).filter(
      (c) =>
        checkEligibility(c, g).ok && hasSpotFor(spots, NOBODY, c.lineupGender),
    );
    // Respect email settings now, so the count is who will really hear;
    // the outbox checks again at send time.
    const choices =
      reachable.length === 0
        ? []
        : await tx
            .select({
              userId: notificationPreference.userId,
              enabled: notificationPreference.enabled,
            })
            .from(notificationPreference)
            .where(
              and(
                inArray(
                  notificationPreference.userId,
                  reachable.map((c) => c.userId),
                ),
                eq(notificationPreference.topic, "sub_request"),
                eq(notificationPreference.channel, "email"),
              ),
            );
    const told = reachable
      .filter((c) =>
        wantsEmail(
          choices
            .filter((choice) => choice.userId === c.userId)
            .map((choice) => ({
              topic: "sub_request" as const,
              enabled: choice.enabled,
            })),
          "sub_request",
        ),
      )
      // Free agents first (information-architecture.md, section 2.6).
      .sort((a, b) => Number(isFreeAgent(b)) - Number(isFreeAgent(a)));
    const base = {
      ...aboutGame(g, input.teamSeasonId),
      spots: describeSpots(spots),
      note: input.note,
    };
    const notified = await enqueueMessages(
      tx,
      told.map((c) => ({
        userId: c.userId,
        topic: "sub_request" as const,
        template: "sub_request",
        payload: {
          ...base,
          freeAgent: isFreeAgent(c),
        } satisfies SubRequestPayload,
        dedupeKey: `sub_request/${created.id}/${c.userId}`,
        sendAfter: now,
      })),
    );
    return ok({ id: created.id, notified });
  });
}

/** Locks a request and returns it with its game, or null. */
async function lockRequest(db: Db, requestId: SubRequestId) {
  const [row] = await db
    .select()
    .from(subRequest)
    .where(eq(subRequest.id, requestId))
    .for("update");
  if (!row) return null;
  const g = await subGame(db, row.gameId);
  return g ? { request: row, game: g } : null;
}

const isOpen = (r: { status: string; closesAt: Date }, now: Date) =>
  r.status === "open" && r.closesAt > now;

export type ClaimError =
  | Ineligible
  | "not_found"
  | "closed"
  | "full"
  | "already_claimed"
  | "declined_before";

/**
 * A player says "I'm in". The claim holds a spot until the captain answers,
 * so it fails once every spot is held, or when the only spots left are
 * reserved for a fielding group the player is not in. Tells the captains.
 */
export async function claimSubSpot(
  db: Db,
  input: { requestId: SubRequestId; userId: UserId; now: Date },
): Promise<Result<SubClaimId, ClaimError>> {
  const { now } = input;
  return db.transaction(async (tx) => {
    const found = await lockRequest(tx, input.requestId);
    if (!found) return err("not_found");
    const { request, game: g } = found;
    if (!isOpen(request, now) || g.kind === "playoff") return err("closed");
    const [me] = await candidatesFor(tx, g, input.userId);
    const eligible = me
      ? checkEligibility(me, g)
      : err("not_registered" as const);
    if (!eligible.ok) return eligible;
    const [previous] = await tx
      .select({ id: subClaim.id, status: subClaim.status })
      .from(subClaim)
      .where(
        and(
          eq(subClaim.subRequestId, request.id),
          eq(subClaim.userId, input.userId),
        ),
      );
    if (previous?.status === "pending" || previous?.status === "approved")
      return err("already_claimed");
    if (previous?.status === "declined") return err("declined_before");
    const gender: LineupGender | null = me?.lineupGender ?? null;
    if (!hasSpotFor(request, await heldOn(tx, request.id), gender))
      return err("full");

    const values = {
      status: "pending" as const,
      lineupGender: gender,
      claimedAt: now,
      decidedAt: null,
      decidedBy: null,
    };
    const [claim] = previous
      ? await tx
          .update(subClaim)
          .set(values)
          .where(eq(subClaim.id, previous.id))
          .returning({ id: subClaim.id })
      : await tx
          .insert(subClaim)
          .values({
            ...values,
            subRequestId: request.id,
            userId: input.userId,
          })
          .returning({ id: subClaim.id });
    if (!claim) throw new Error("Expected a sub claim row");
    const player = await nameOf(tx, input.userId);
    const about = aboutGame(g, request.teamSeasonId);
    await enqueueMessages(
      tx,
      (await captainsOf(tx, request.teamSeasonId)).map((captain) =>
        update(
          captain,
          `sub_claimed/${claim.id}/${now.getTime()}/${captain}`,
          { ...about, kind: "claimed", player },
          now,
        ),
      ),
    );
    return ok(claim.id);
  });
}

/** The team a claim's request is for, so the caller can check permissions. */
export async function claimTeam(
  db: Db,
  claimId: SubClaimId,
): Promise<TeamSeasonId | null> {
  const [row] = await db
    .select({ teamSeasonId: subRequest.teamSeasonId })
    .from(subClaim)
    .innerJoin(subRequest, eq(subClaim.subRequestId, subRequest.id))
    .where(eq(subClaim.id, claimId));
  return row?.teamSeasonId ?? null;
}

/** The team a request is for, so the caller can check permissions. */
export async function requestTeam(
  db: Db,
  requestId: SubRequestId,
): Promise<TeamSeasonId | null> {
  const [row] = await db
    .select({ teamSeasonId: subRequest.teamSeasonId })
    .from(subRequest)
    .where(eq(subRequest.id, requestId));
  return row?.teamSeasonId ?? null;
}

export type DecideError = "not_found" | "closed" | "not_pending";

/**
 * The captain approves or declines a pending claim. The request is filled
 * once approved subs take every spot. Tells the player. The caller checks
 * sub_request.decide for the claim's team.
 */
export async function decideSubClaim(
  db: Db,
  input: {
    claimId: SubClaimId;
    decidedBy: UserId;
    decision: "approved" | "declined";
    now: Date;
  },
): Promise<Result<void, DecideError>> {
  const { now } = input;
  return db.transaction(async (tx) => {
    const [claim] = await tx
      .select({
        id: subClaim.id,
        subRequestId: subClaim.subRequestId,
        userId: subClaim.userId,
      })
      .from(subClaim)
      .where(eq(subClaim.id, input.claimId));
    if (!claim) return err("not_found");
    const found = await lockRequest(tx, claim.subRequestId);
    if (!found) return err("not_found");
    const { request, game: g } = found;
    if (request.status === "cancelled" || request.closesAt <= now)
      return err("closed");
    // Read again under the request's lock: another captain may have answered.
    const [changed] = await tx
      .update(subClaim)
      .set({
        status: input.decision,
        decidedAt: now,
        decidedBy: input.decidedBy,
      })
      .where(and(eq(subClaim.id, claim.id), eq(subClaim.status, "pending")))
      .returning({ id: subClaim.id });
    if (!changed) return err("not_pending");
    if (input.decision === "approved") {
      const [approved] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(subClaim)
        .where(
          and(
            eq(subClaim.subRequestId, request.id),
            eq(subClaim.status, "approved"),
          ),
        );
      if ((approved?.count ?? 0) >= request.needed)
        await tx
          .update(subRequest)
          .set({ status: "filled" })
          .where(eq(subRequest.id, request.id));
    }
    await enqueueMessages(tx, [
      update(
        claim.userId,
        `sub_${input.decision}/${claim.id}/${now.getTime()}`,
        { ...aboutGame(g, request.teamSeasonId), kind: input.decision },
        now,
      ),
    ]);
    return ok(undefined);
  });
}

export type WithdrawError = "not_found" | "closed";

/**
 * A player backs out of their own claim before game time. Their spot opens
 * again; if they were approved, the captains hear about it.
 */
export async function withdrawSubClaim(
  db: Db,
  input: { requestId: SubRequestId; userId: UserId; now: Date },
): Promise<Result<void, WithdrawError>> {
  const { now } = input;
  return db.transaction(async (tx) => {
    const found = await lockRequest(tx, input.requestId);
    if (!found) return err("not_found");
    const { request, game: g } = found;
    if (request.status === "cancelled" || request.closesAt <= now)
      return err("closed");
    const [claim] = await tx
      .update(subClaim)
      .set({ status: "withdrawn", decidedAt: now, decidedBy: input.userId })
      .where(
        and(
          eq(subClaim.subRequestId, request.id),
          eq(subClaim.userId, input.userId),
          inArray(subClaim.status, ["pending", "approved"]),
        ),
      )
      .returning({ id: subClaim.id });
    if (!claim) return err("not_found");
    if (request.status === "filled")
      await tx
        .update(subRequest)
        .set({ status: "open" })
        .where(eq(subRequest.id, request.id));
    const player = await nameOf(tx, input.userId);
    const about = aboutGame(g, request.teamSeasonId);
    await enqueueMessages(
      tx,
      (await captainsOf(tx, request.teamSeasonId)).map((captain) =>
        update(
          captain,
          `sub_withdrawn/${claim.id}/${now.getTime()}/${captain}`,
          { ...about, kind: "withdrawn", player },
          now,
        ),
      ),
    );
    return ok(undefined);
  });
}

/**
 * The captain takes a request down. Players holding a spot hear that they
 * are not playing. The caller checks sub_request.decide for its team.
 */
export async function cancelSubRequest(
  db: Db,
  input: { requestId: SubRequestId; now: Date },
): Promise<Result<void, "not_found" | "closed">> {
  const { now } = input;
  return db.transaction(async (tx) => {
    const found = await lockRequest(tx, input.requestId);
    if (!found) return err("not_found");
    const { request, game: g } = found;
    if (request.status === "cancelled" || request.closesAt <= now)
      return err("closed");
    await tx
      .update(subRequest)
      .set({ status: "cancelled" })
      .where(eq(subRequest.id, request.id));
    const holding = await tx
      .update(subClaim)
      .set({ status: "declined", decidedAt: now })
      .where(
        and(
          eq(subClaim.subRequestId, request.id),
          inArray(subClaim.status, ["pending", "approved"]),
        ),
      )
      .returning({ id: subClaim.id, userId: subClaim.userId });
    const about = aboutGame(g, request.teamSeasonId);
    await enqueueMessages(
      tx,
      holding.map((c) =>
        update(
          c.userId,
          `sub_cancelled/${request.id}/${c.userId}`,
          { ...about, kind: "cancelled" },
          now,
        ),
      ),
    );
    return ok(undefined);
  });
}

export type ClaimRow = {
  id: SubClaimId;
  userId: UserId;
  name: string;
  lineupGender: LineupGender | null;
  status: "pending" | "approved" | "declined" | "withdrawn";
};

export type TeamSubRequest = {
  id: SubRequestId;
  gameId: GameId;
  spots: Spots;
  note: string | null;
  status: "open" | "filled" | "cancelled";
  closesAt: Date;
  claims: ClaimRow[];
};

async function claimsOn(
  db: Db,
  requestIds: readonly SubRequestId[],
): Promise<(ClaimRow & { subRequestId: SubRequestId })[]> {
  if (requestIds.length === 0) return [];
  return db
    .select({
      id: subClaim.id,
      subRequestId: subClaim.subRequestId,
      userId: subClaim.userId,
      name: shortName,
      lineupGender: subClaim.lineupGender,
      status: subClaim.status,
    })
    .from(subClaim)
    .innerJoin(user, eq(subClaim.userId, user.id))
    .leftJoin(profile, eq(profile.userId, user.id))
    .where(inArray(subClaim.subRequestId, [...requestIds]))
    .orderBy(asc(subClaim.claimedAt));
}

/** A team's live requests for games still to come, with their claims. */
export async function teamSubRequests(
  db: Db,
  teamSeasonId: TeamSeasonId,
  now: Date,
): Promise<TeamSubRequest[]> {
  const requests = await db
    .select()
    .from(subRequest)
    .where(
      and(
        eq(subRequest.teamSeasonId, teamSeasonId),
        inArray(subRequest.status, ["open", "filled"]),
        gt(subRequest.closesAt, now),
      ),
    )
    .orderBy(asc(subRequest.closesAt));
  const claims = await claimsOn(
    db,
    requests.map((r) => r.id),
  );
  return requests.map((r) => ({
    id: r.id,
    gameId: r.gameId,
    spots: {
      needed: r.needed,
      womenNeeded: r.womenNeeded,
      menNeeded: r.menNeeded,
    },
    note: r.note,
    status: r.status,
    closesAt: r.closesAt,
    claims: claims.filter((c) => c.subRequestId === r.id),
  }));
}

export type OpenRequest = {
  id: SubRequestId;
  game: SubGameInfo;
  team: string;
  spots: Spots;
  note: string | null;
  left: number;
  /** Null when the player can take a spot; otherwise why not. */
  blocked: Ineligible | "full" | null;
  /** The player's own claim on it, if any. */
  mine: ClaimRow["status"] | null;
};

/**
 * The sub page: open requests in the seasons a person is registered for,
 * each with whether they can take a spot, plus requests they hold a spot
 * on (open or filled) so an approved sub sees their game.
 */
export async function subRequestsFor(
  db: Db,
  userId: UserId,
  now: Date,
): Promise<OpenRequest[]> {
  const seasons = db
    .select({ id: registration.seasonId })
    .from(registration)
    .where(eq(registration.userId, userId));
  const mineIds = db
    .select({ id: subClaim.subRequestId })
    .from(subClaim)
    .where(eq(subClaim.userId, userId));
  const requests = await db
    .select({ request: subRequest, seasonId: game.seasonId })
    .from(subRequest)
    .innerJoin(game, eq(subRequest.gameId, game.id))
    .where(
      and(
        gt(subRequest.closesAt, now),
        ne(subRequest.status, "cancelled"),
        inArray(game.seasonId, seasons),
        or(eq(subRequest.status, "open"), inArray(subRequest.id, mineIds)),
      ),
    )
    .orderBy(asc(subRequest.closesAt));
  const claims = await claimsOn(
    db,
    requests.map((r) => r.request.id),
  );
  const result: OpenRequest[] = [];
  for (const { request: r } of requests) {
    const g = await subGame(db, r.gameId);
    if (!g) continue;
    const [me] = await candidatesFor(db, g, userId);
    const spots = {
      needed: r.needed,
      womenNeeded: r.womenNeeded,
      menNeeded: r.menNeeded,
    };
    const on = claims.filter((c) => c.subRequestId === r.id);
    const holding = on.filter(
      (c) => c.status === "pending" || c.status === "approved",
    );
    const held: Held = {
      women: holding.filter((c) => c.lineupGender === "woman").length,
      men: holding.filter((c) => c.lineupGender === "man").length,
      unknown: holding.filter((c) => c.lineupGender === null).length,
    };
    const mine = on.find((c) => c.userId === userId)?.status ?? null;
    const eligible: Result<void, Ineligible> = me
      ? checkEligibility(me, g)
      : err("not_registered");
    // The team asking never sees its own request here.
    if (!eligible.ok && eligible.error === "plays_in_game" && mine === null)
      continue;
    result.push({
      id: r.id,
      game: g,
      team: aboutGame(g, r.teamSeasonId).team,
      spots,
      note: r.note,
      left: openSpots(spots, held).left,
      blocked: !eligible.ok
        ? eligible.error
        : hasSpotFor(spots, held, me?.lineupGender ?? null)
          ? null
          : "full",
      mine,
    });
  }
  return result;
}

export type Pickup = { teamSeasonId: TeamSeasonId; name: string };

/**
 * Approved subs for each game, by team: what the opposing captain and the
 * ref see, as the rulebook asks. Cancelled requests have no pickups.
 */
export async function pickupsFor(
  db: Db,
  gameIds: readonly GameId[],
): Promise<Map<GameId, Pickup[]>> {
  const result = new Map<GameId, Pickup[]>();
  if (gameIds.length === 0) return result;
  const rows = await db
    .select({
      gameId: subRequest.gameId,
      teamSeasonId: subRequest.teamSeasonId,
      name: shortName,
    })
    .from(subClaim)
    .innerJoin(subRequest, eq(subClaim.subRequestId, subRequest.id))
    .innerJoin(user, eq(subClaim.userId, user.id))
    .leftJoin(profile, eq(profile.userId, user.id))
    .where(
      and(
        inArray(subRequest.gameId, [...gameIds]),
        ne(subRequest.status, "cancelled"),
        eq(subClaim.status, "approved"),
      ),
    )
    .orderBy(asc(subClaim.claimedAt));
  for (const r of rows)
    result.set(r.gameId, [
      ...(result.get(r.gameId) ?? []),
      { teamSeasonId: r.teamSeasonId, name: r.name },
    ]);
  return result;
}
