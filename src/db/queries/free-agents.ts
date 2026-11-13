import { and, count, eq, inArray, isNull, ne, notInArray } from "drizzle-orm";
import type {
  FriendGroupId,
  LeagueId,
  RegistrationId,
  SeasonId,
  TeamId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { FRIEND_GROUP_MAX, newFriendCode } from "@/domain/matcher/friend-code";
import type { MatchTeam, PoolPlayer } from "@/domain/matcher/matcher";
import {
  readAnswers,
  type ParsedQuiz,
  type QuizAnswers,
} from "@/domain/matcher/quiz";
import { err, ok, type Result } from "@/domain/result";
import { slugify } from "@/domain/slug";
import { user } from "../schema/auth";
import { freeAgentProfile } from "../schema/free-agent";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import {
  friendGroup,
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { recordAudit } from "./audit";
import { placeFreeAgent, type PlaceError } from "./registrations-admin";
import { required } from "./rows";
import type { Db } from "./schedule";

/**
 * The free-agent quiz, friend codes and the matcher's view of a season
 * (roadmap section 4, milestone 5). The matching itself is pure, in
 * src/domain/matcher.
 */

/** Registrations that can still be placed: not cancelled, refunded or waitlisted. */
const PLACEABLE = ["pending_waiver", "pending_payment", "active"] as const;

/** A team the schedule includes; the matcher only suggests these. */
const OPEN_TEAM = ["forming", "pending_payment", "confirmed"] as const;

const shortName = (
  first: string | null,
  last: string | null,
  fallback: string,
) => (first ? `${first}${last ? ` ${last.charAt(0)}.` : ""}` : fallback);

/** The person's own quiz page: their registration, answers and group. */
export async function myQuiz(db: Db, seasonId: SeasonId, userId: UserId) {
  const [mine] = await db
    .select({
      id: registration.id,
      kind: registration.kind,
      friendGroupId: registration.friendGroupId,
      answers: freeAgentProfile.answers,
      notes: freeAgentProfile.notes,
      code: friendGroup.code,
      teamSeasonId: rosterMembership.teamSeasonId,
    })
    .from(registration)
    .leftJoin(
      freeAgentProfile,
      eq(freeAgentProfile.registrationId, registration.id),
    )
    .leftJoin(friendGroup, eq(registration.friendGroupId, friendGroup.id))
    .leftJoin(
      rosterMembership,
      and(
        eq(rosterMembership.registrationId, registration.id),
        eq(rosterMembership.status, "active"),
      ),
    )
    .where(
      and(
        eq(registration.seasonId, seasonId),
        eq(registration.userId, userId),
        inArray(registration.status, [...PLACEABLE]),
      ),
    );
  if (!mine) return null;
  const friends = mine.friendGroupId
    ? await db
        .select({
          firstName: profile.firstName,
          lastName: profile.lastName,
          accountName: user.name,
        })
        .from(registration)
        .innerJoin(user, eq(registration.userId, user.id))
        .leftJoin(profile, eq(profile.userId, user.id))
        .where(
          and(
            eq(registration.friendGroupId, mine.friendGroupId),
            ne(registration.id, mine.id),
            inArray(registration.status, [...PLACEABLE]),
          ),
        )
    : [];
  return {
    registrationId: mine.id,
    /** Placed on a team already: the quiz and group are settled. */
    placed: mine.teamSeasonId !== null,
    answers: readAnswers(mine.answers),
    notes: mine.notes,
    code: mine.code,
    friends: friends
      .map((f) => shortName(f.firstName, f.lastName, f.accountName))
      .sort(),
  };
}

export type QuizError = "not_in_pool";

/** The registration, if it belongs to the person and is still in the pool. */
async function ownPoolEntry(
  db: Db,
  seasonId: SeasonId,
  userId: UserId,
): Promise<{ id: RegistrationId; friendGroupId: FriendGroupId | null } | null> {
  const [mine] = await db
    .select({ id: registration.id, friendGroupId: registration.friendGroupId })
    .from(registration)
    .leftJoin(
      rosterMembership,
      and(
        eq(rosterMembership.registrationId, registration.id),
        eq(rosterMembership.status, "active"),
      ),
    )
    .where(
      and(
        eq(registration.seasonId, seasonId),
        eq(registration.userId, userId),
        eq(registration.kind, "free_agent"),
        inArray(registration.status, [...PLACEABLE]),
        isNull(rosterMembership.id),
      ),
    );
  return mine ?? null;
}

/** Saves (or replaces) a free agent's quiz answers. */
export async function saveQuiz(
  db: Db,
  input: { seasonId: SeasonId; userId: UserId; quiz: ParsedQuiz },
): Promise<Result<void, QuizError>> {
  const mine = await ownPoolEntry(db, input.seasonId, input.userId);
  if (!mine) return err("not_in_pool");
  const values = {
    answers: input.quiz.answers,
    skillScore: input.quiz.skillScore,
    vibeScore: input.quiz.vibeScore,
    wouldCaptain: input.quiz.wouldCaptain,
    notes: input.quiz.notes,
  };
  await db
    .insert(freeAgentProfile)
    .values({ registrationId: mine.id, ...values })
    .onConflictDoUpdate({
      target: freeAgentProfile.registrationId,
      set: values,
    });
  return ok(undefined);
}

export type GroupError =
  "not_in_pool" | "unknown_code" | "group_full" | "already_in_group";

/** Members of a group who are still registered this season. */
async function groupSize(db: Db, groupId: FriendGroupId) {
  const [row] = await db
    .select({ n: count() })
    .from(registration)
    .where(
      and(
        eq(registration.friendGroupId, groupId),
        inArray(registration.status, [...PLACEABLE]),
      ),
    );
  return row?.n ?? 0;
}

/**
 * Starts a friend group with a new code and puts the person in it, leaving
 * any group they were in. `random` returns a float in [0, 1).
 */
export async function startFriendGroup(
  db: Db,
  input: { seasonId: SeasonId; userId: UserId; random: () => number },
): Promise<Result<string, GroupError>> {
  const mine = await ownPoolEntry(db, input.seasonId, input.userId);
  if (!mine) return err("not_in_pool");
  // 31^6 is about 900 million codes; a clash is rare, so a few tries do.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newFriendCode(input.random);
    const [created] = await db
      .insert(friendGroup)
      .values({ seasonId: input.seasonId, code, createdBy: input.userId })
      .onConflictDoNothing({ target: friendGroup.code })
      .returning({ id: friendGroup.id });
    if (!created) continue;
    await db
      .update(registration)
      .set({ friendGroupId: created.id })
      .where(eq(registration.id, mine.id));
    return ok(code);
  }
  throw new Error("Could not find a free friend code after 5 tries");
}

/** Joins the group with `code` in the same season, if it has room. */
export async function joinFriendGroup(
  db: Db,
  input: { seasonId: SeasonId; userId: UserId; code: string },
): Promise<Result<void, GroupError>> {
  const mine = await ownPoolEntry(db, input.seasonId, input.userId);
  if (!mine) return err("not_in_pool");
  const [group] = await db
    .select({ id: friendGroup.id })
    .from(friendGroup)
    .where(
      and(
        eq(friendGroup.code, input.code),
        eq(friendGroup.seasonId, input.seasonId),
      ),
    );
  if (!group) return err("unknown_code");
  if (mine.friendGroupId === group.id) return err("already_in_group");
  if ((await groupSize(db, group.id)) >= FRIEND_GROUP_MAX)
    return err("group_full");
  await db
    .update(registration)
    .set({ friendGroupId: group.id })
    .where(eq(registration.id, mine.id));
  return ok(undefined);
}

/** Leaves the person's friend group. The group lives on for the others. */
export async function leaveFriendGroup(
  db: Db,
  input: { seasonId: SeasonId; userId: UserId },
): Promise<Result<void, GroupError>> {
  const mine = await ownPoolEntry(db, input.seasonId, input.userId);
  if (!mine) return err("not_in_pool");
  await db
    .update(registration)
    .set({ friendGroupId: null })
    .where(eq(registration.id, mine.id));
  return ok(undefined);
}

export type PoolEntry = PoolPlayer & {
  registrationId: RegistrationId;
  signed: boolean;
  paid: boolean;
  answers: QuizAnswers | null;
  notes: string | null;
  code: string | null;
};

export type MatcherTeam = MatchTeam & {
  teamSeasonId: TeamSeasonId;
  colorHex: string | null;
  status: string;
};

/**
 * Everything the matcher page needs for a season, in three queries: the
 * season's limits, its open teams, and every placeable registration with
 * profile, quiz, group and team.
 */
export async function matcherInput(db: Db, seasonId: SeasonId) {
  const [limits, entries, people] = await Promise.all([
    db
      .select({
        leagueId: season.leagueId,
        rosterMin: season.rosterMin,
        rosterMax: season.rosterMax,
      })
      .from(season)
      .where(eq(season.id, seasonId)),
    db
      .select({
        teamSeasonId: teamSeason.id,
        name: team.name,
        colorHex: team.colorHex,
        status: teamSeason.status,
        targetRosterSize: teamSeason.targetRosterSize,
      })
      .from(teamSeason)
      .innerJoin(team, eq(teamSeason.teamId, team.id))
      .where(
        and(
          eq(teamSeason.seasonId, seasonId),
          inArray(teamSeason.status, [...OPEN_TEAM]),
        ),
      ),
    db
      .select({
        registrationId: registration.id,
        status: registration.status,
        waiverSignatureId: registration.waiverSignatureId,
        createdAt: registration.createdAt,
        groupId: registration.friendGroupId,
        code: friendGroup.code,
        firstName: profile.firstName,
        lastName: profile.lastName,
        lineupGender: profile.lineupGender,
        accountName: user.name,
        email: user.email,
        answers: freeAgentProfile.answers,
        skill: freeAgentProfile.skillScore,
        vibe: freeAgentProfile.vibeScore,
        notes: freeAgentProfile.notes,
        teamSeasonId: rosterMembership.teamSeasonId,
      })
      .from(registration)
      .innerJoin(user, eq(registration.userId, user.id))
      .leftJoin(profile, eq(profile.userId, user.id))
      .leftJoin(
        freeAgentProfile,
        eq(freeAgentProfile.registrationId, registration.id),
      )
      .leftJoin(friendGroup, eq(registration.friendGroupId, friendGroup.id))
      .leftJoin(
        rosterMembership,
        and(
          eq(rosterMembership.registrationId, registration.id),
          eq(rosterMembership.status, "active"),
        ),
      )
      .where(
        and(
          eq(registration.seasonId, seasonId),
          inArray(registration.status, [...PLACEABLE]),
        ),
      )
      .orderBy(registration.createdAt, registration.id),
  ]);
  const limit = limits[0];
  if (!limit) return null;

  const players = people.map((p, order) => {
    const answers = readAnswers(p.answers);
    return {
      teamSeasonId: p.teamSeasonId,
      entry: {
        registrationId: p.registrationId,
        name:
          p.firstName && p.lastName
            ? `${p.firstName} ${p.lastName}`
            : p.accountName || p.email,
        side: p.lineupGender,
        skill: p.skill,
        vibe: p.vibe,
        availability: answers?.availability ?? null,
        positions: answers?.positions ?? [],
        groupId: p.groupId,
        captain: answers?.captain ?? null,
        order,
        signed: p.waiverSignatureId !== null || p.status !== "pending_waiver",
        paid: p.status === "active",
        answers,
        notes: p.notes,
        code: p.code,
      } satisfies PoolEntry,
    };
  });
  const teams: MatcherTeam[] = entries
    .map((e) => ({
      teamSeasonId: e.teamSeasonId,
      name: e.name,
      colorHex: e.colorHex,
      status: e.status,
      capacity: Math.min(
        e.targetRosterSize ?? limit.rosterMax,
        limit.rosterMax,
      ),
      members: players
        .filter((p) => p.teamSeasonId === e.teamSeasonId)
        .map((p) => p.entry),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const pool = players
    .filter((p) => p.teamSeasonId === null)
    .map((p) => p.entry);
  return { ...limit, teams, pool };
}

export type GroupPlaceError = PlaceError | "splits_group";

/**
 * Places several free agents on one team at once, all or none (an applied
 * suggestion). Run it in a transaction: every check runs before the first
 * write, and a placement that still fails, from a race, throws so the
 * transaction rolls back.
 */
export async function placeTogether(
  db: Db,
  input: {
    seasonId: SeasonId;
    registrationIds: RegistrationId[];
    teamSeasonId: TeamSeasonId;
    actorId: UserId;
    now: Date;
  },
): Promise<Result<void, GroupPlaceError>> {
  const ids = [...new Set(input.registrationIds)];
  if (ids.length === 0) return err("unknown_registration");
  const found = await db
    .select({
      id: registration.id,
      groupId: registration.friendGroupId,
      spot: rosterMembership.id,
    })
    .from(registration)
    .leftJoin(
      rosterMembership,
      and(
        eq(rosterMembership.registrationId, registration.id),
        eq(rosterMembership.status, "active"),
      ),
    )
    .where(
      and(
        inArray(registration.id, ids),
        eq(registration.seasonId, input.seasonId),
        inArray(registration.status, [...PLACEABLE]),
      ),
    );
  if (found.length !== ids.length) return err("unknown_registration");
  if (found.some((f) => f.spot !== null)) return err("already_on_team");
  const split = await groupMembersLeftOut(db, found, ids);
  if (split) return err("splits_group");

  const [target] = await db
    .select({ rosterMax: season.rosterMax })
    .from(teamSeason)
    .innerJoin(season, eq(teamSeason.seasonId, season.id))
    .where(
      and(
        eq(teamSeason.id, input.teamSeasonId),
        eq(teamSeason.seasonId, input.seasonId),
        ne(teamSeason.status, "withdrawn"),
      ),
    );
  if (!target) return err("unknown_team");
  const [members] = await db
    .select({ n: count() })
    .from(rosterMembership)
    .where(
      and(
        eq(rosterMembership.teamSeasonId, input.teamSeasonId),
        eq(rosterMembership.status, "active"),
      ),
    );
  if ((members?.n ?? 0) + ids.length > target.rosterMax) return err("full");

  for (const registrationId of ids) {
    const placed = await placeFreeAgent(db, { ...input, registrationId });
    if (!placed.ok)
      throw new Error(`Placement changed underneath us: ${placed.error}`);
  }
  return ok(undefined);
}

/**
 * Whether placing `ids` would leave a friend in the pool behind: someone in
 * the same group, still unplaced, who is not among `ids`.
 */
async function groupMembersLeftOut(
  db: Db,
  found: readonly { groupId: FriendGroupId | null }[],
  ids: readonly RegistrationId[],
): Promise<boolean> {
  const groups = [...new Set(found.flatMap((f) => f.groupId ?? []))];
  if (groups.length === 0) return false;
  const others = await db
    .select({ id: registration.id })
    .from(registration)
    .leftJoin(
      rosterMembership,
      and(
        eq(rosterMembership.registrationId, registration.id),
        eq(rosterMembership.status, "active"),
      ),
    )
    .where(
      and(
        inArray(registration.friendGroupId, groups),
        notInArray(registration.id, [...ids]),
        inArray(registration.status, [...PLACEABLE]),
        isNull(rosterMembership.id),
      ),
    );
  return others.length > 0;
}

export type BuildTeamError =
  | GroupPlaceError
  | "bad_name"
  | "name_taken"
  | "bad_color"
  | "no_captain"
  | "too_many";

/**
 * Builds a new team from the pool (product-spec.md: "Build a new team from
 * free agents with volunteer captains"). The team starts "forming". Its
 * players keep their free-agent registrations, so each pays (or has paid)
 * the free-agent fee; per team, anyone the captain invites later pays that
 * same amount as a fixed share (see the ADR "Teams built from the pool").
 */
export async function buildTeamFromPool(
  db: Db,
  input: {
    leagueId: LeagueId;
    seasonId: SeasonId;
    name: string;
    colorHex: string | null;
    captainId: RegistrationId;
    registrationIds: RegistrationId[];
    actorId: UserId;
    now: Date;
  },
): Promise<
  Result<{ teamSeasonId: TeamSeasonId; slug: string }, BuildTeamError>
> {
  const name = input.name.trim().replace(/\s+/g, " ");
  const slug = slugify(name);
  if (!slug || name.length > 40) return err("bad_name");
  if (input.colorHex !== null && !/^#[0-9A-Fa-f]{6}$/.test(input.colorHex))
    return err("bad_color");
  const ids = [...new Set(input.registrationIds)];
  if (!ids.includes(input.captainId)) return err("no_captain");

  const [s] = await db
    .select({
      rosterMax: season.rosterMax,
      rosterMin: season.rosterMin,
      feeModel: season.feeModel,
      freeAgentFeeCents: season.freeAgentFeeCents,
    })
    .from(season)
    .where(
      and(eq(season.id, input.seasonId), eq(season.leagueId, input.leagueId)),
    );
  if (!s) return err("unknown_team");
  if (ids.length > s.rosterMax) return err("too_many");

  const found = await db
    .select({
      id: registration.id,
      groupId: registration.friendGroupId,
      spot: rosterMembership.id,
    })
    .from(registration)
    .leftJoin(
      rosterMembership,
      and(
        eq(rosterMembership.registrationId, registration.id),
        eq(rosterMembership.status, "active"),
      ),
    )
    .where(
      and(
        inArray(registration.id, ids),
        eq(registration.seasonId, input.seasonId),
        inArray(registration.status, [...PLACEABLE]),
      ),
    );
  if (found.length !== ids.length) return err("unknown_registration");
  if (found.some((f) => f.spot !== null)) return err("already_on_team");
  if (await groupMembersLeftOut(db, found, ids)) return err("splits_group");

  const [taken] = await db
    .select({ id: team.id })
    .from(team)
    .where(and(eq(team.leagueId, input.leagueId), eq(team.slug, slug)));
  if (taken) return err("name_taken");

  const [created] = await db
    .insert(team)
    .values({
      leagueId: input.leagueId,
      name,
      slug,
      colorHex: input.colorHex,
      createdBy: input.actorId,
    })
    .returning({ id: team.id });
  const teamId: TeamId = required(created, "team").id;
  const perTeam = s.feeModel === "per_team";
  const [entry] = await db
    .insert(teamSeason)
    .values({
      teamId,
      seasonId: input.seasonId,
      status: "forming",
      paymentMode: perTeam ? "split" : "full",
      shareCents: perTeam ? s.freeAgentFeeCents : null,
      targetRosterSize: Math.min(
        s.rosterMax,
        Math.max(s.rosterMin, ids.length),
      ),
      createdBy: input.actorId,
    })
    .returning({ id: teamSeason.id });
  const teamSeasonId = required(entry, "team season").id;
  await db.insert(rosterMembership).values(
    ids.map((registrationId) => ({
      teamSeasonId,
      registrationId,
      role:
        registrationId === input.captainId
          ? ("captain" as const)
          : ("player" as const),
      status: "active" as const,
      startedAt: input.now,
      createdBy: input.actorId,
    })),
  );
  await recordAudit(db, {
    actorId: input.actorId,
    action: "free_agents.build_team",
    entityType: "team_season",
    entityId: teamSeasonId,
    after: {
      teamId,
      captainRegistrationId: input.captainId,
      registrationIds: ids,
    },
  });
  return ok({ teamSeasonId, slug });
}
