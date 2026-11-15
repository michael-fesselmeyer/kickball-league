import {
  aliasedTable,
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import {
  assignedNow,
  bringBy,
  checkAnswer,
  checkCancel,
  checkHandOff,
  checkPickUp,
  checkReturnHome,
  type KitInput,
  type KitState,
  type MissingReport,
  mayReport,
  nextReceiver,
  placeName,
  remindsTonight,
} from "@/domain/equipment/equipment";
import type {
  EquipmentAssignmentId,
  EquipmentHandoffId,
  EquipmentKitId,
  EquipmentReportId,
  GameId,
  LeagueId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import type { GearReminderPayload } from "@/emails/gear-reminder";
import { user } from "../schema/auth";
import {
  equipmentAssignment,
  equipmentHandoff,
  equipmentKit,
  equipmentReport,
} from "../schema/equipment";
import { field, game, refereeAssignment, slot, venue } from "../schema/game";
import { league, leagueMember } from "../schema/league";
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
 * The league's gear (issue #286; docs/data-model.md, section 2.10). The
 * rules are in src/domain/equipment; this file reads and writes kits,
 * assignments, handoffs and missing-item reports. Every change locks the
 * kit's row first, so two taps on the same kit are served one at a time,
 * and writes its audit entry in the same transaction.
 */

/** "Jo S.": first name and last initial, as on public rosters. */
const shortName = sql<string>`coalesce(${profile.firstName} || coalesce(' ' || left(${profile.lastName}, 1) || '.', ''), nullif(${user.name}, ''), 'A player')`;

/** Short names for a set of people, in one query. */
async function namesOf(
  db: Db,
  ids: readonly (UserId | null)[],
): Promise<Map<UserId, string>> {
  const wanted = [...new Set(ids.filter((id): id is UserId => id !== null))];
  if (wanted.length === 0) return new Map();
  const rows = await db
    .select({ id: user.id, name: shortName })
    .from(user)
    .leftJoin(profile, eq(profile.userId, user.id))
    .where(inArray(user.id, wanted));
  return new Map(rows.map((r) => [r.id, r.name]));
}

const teamA = aliasedTable(team, "gear_team_a");
const teamB = aliasedTable(team, "gear_team_b");
const entryA = aliasedTable(teamSeason, "gear_entry_a");
const entryB = aliasedTable(teamSeason, "gear_entry_b");

/** A game a kit can go to, with where and when. */
export type GearGame = {
  gameId: GameId;
  startsAt: Date;
  endsAt: Date;
  place: string;
  teamAName: string;
  teamBName: string;
  timeZone: string;
};

/** A game that is still on: not over, not called off. */
const gameIsOn = (now: Date) =>
  and(
    gt(slot.endsAt, now),
    eq(slot.status, "open"),
    inArray(game.status, ["scheduled", "in_progress"]),
  );

const gameColumns = {
  gameId: game.id,
  startsAt: slot.startsAt,
  endsAt: slot.endsAt,
  venueName: venue.name,
  fieldName: field.name,
  teamAName: teamA.name,
  teamBName: teamB.name,
  timeZone: league.timezone,
};

type GameRow = {
  gameId: GameId;
  startsAt: Date;
  endsAt: Date;
  venueName: string;
  fieldName: string;
  teamAName: string;
  teamBName: string;
  timeZone: string;
};

const asGame = (r: GameRow): GearGame => ({
  gameId: r.gameId,
  startsAt: r.startsAt,
  endsAt: r.endsAt,
  place: placeName(r.venueName, r.fieldName),
  teamAName: r.teamAName,
  teamBName: r.teamBName,
  timeZone: r.timeZone,
});

export type GearAssignment = GearGame & {
  id: EquipmentAssignmentId;
  kitId: EquipmentKitId;
  userId: UserId;
};

/** Assignments with their games, for the kits or people asked about. */
async function assignmentsWhere(
  db: Db,
  where: ReturnType<typeof and>,
): Promise<GearAssignment[]> {
  const rows = await db
    .select({
      id: equipmentAssignment.id,
      kitId: equipmentAssignment.kitId,
      userId: equipmentAssignment.userId,
      ...gameColumns,
    })
    .from(equipmentAssignment)
    .innerJoin(equipmentKit, eq(equipmentAssignment.kitId, equipmentKit.id))
    .innerJoin(game, eq(equipmentAssignment.gameId, game.id))
    .innerJoin(slot, eq(game.slotId, slot.id))
    .innerJoin(field, eq(slot.fieldId, field.id))
    .innerJoin(venue, eq(field.venueId, venue.id))
    .innerJoin(season, eq(game.seasonId, season.id))
    .innerJoin(league, eq(season.leagueId, league.id))
    .innerJoin(entryA, eq(game.teamAId, entryA.id))
    .innerJoin(teamA, eq(entryA.teamId, teamA.id))
    .innerJoin(entryB, eq(game.teamBId, entryB.id))
    .innerJoin(teamB, eq(entryB.teamId, teamB.id))
    .where(where)
    .orderBy(asc(slot.startsAt));
  return rows.map((r) => ({
    ...asGame(r),
    id: r.id,
    kitId: r.kitId,
    userId: r.userId,
  }));
}

/** Upcoming assignments (games still on) for these kits. */
const upcomingFor = (db: Db, kitIds: readonly EquipmentKitId[], now: Date) =>
  kitIds.length === 0
    ? Promise.resolve([])
    : assignmentsWhere(
        db,
        and(inArray(equipmentAssignment.kitId, [...kitIds]), gameIsOn(now)),
      );

/** The pending handoff of each of these kits. */
async function pendingFor(db: Db, kitIds: readonly EquipmentKitId[]) {
  if (kitIds.length === 0) return [];
  return db
    .select({
      id: equipmentHandoff.id,
      kitId: equipmentHandoff.kitId,
      fromUserId: equipmentHandoff.fromUserId,
      toUserId: equipmentHandoff.toUserId,
      createdAt: equipmentHandoff.createdAt,
    })
    .from(equipmentHandoff)
    .where(
      and(
        inArray(equipmentHandoff.kitId, [...kitIds]),
        eq(equipmentHandoff.status, "pending"),
      ),
    );
}

type LockedKit = {
  id: EquipmentKitId;
  leagueId: LeagueId;
  name: string;
  contents: string[];
  homeLocation: string;
  holderId: UserId | null;
  retiredAt: Date | null;
};

/** Locks a kit's row and reads its state with any pending handoff. */
async function lockKit(db: Db, kitId: EquipmentKitId) {
  const [kit] = await db
    .select({
      id: equipmentKit.id,
      leagueId: equipmentKit.leagueId,
      name: equipmentKit.name,
      contents: equipmentKit.contents,
      homeLocation: equipmentKit.homeLocation,
      holderId: equipmentKit.holderId,
      retiredAt: equipmentKit.retiredAt,
    })
    .from(equipmentKit)
    .where(eq(equipmentKit.id, kitId))
    .for("update");
  if (!kit) return null;
  const [pending] = await pendingFor(db, [kitId]);
  const state: KitState<UserId> = {
    holderId: kit.holderId,
    retired: kit.retiredAt !== null,
    pending: pending
      ? { fromUserId: pending.fromUserId, toUserId: pending.toUserId }
      : null,
  };
  return { kit, state, pending: pending ?? null };
}

const kitAudit = (kit: LockedKit) => ({
  kit: kit.name,
  holderId: kit.holderId,
});

// ---------------------------------------------------------------------------
// Kits, for admins

export type KitRow = {
  id: EquipmentKitId;
  name: string;
  contents: string[];
  homeLocation: string;
  holderId: UserId | null;
  holderName: string | null;
  pending: {
    id: EquipmentHandoffId;
    fromUserId: UserId | null;
    toUserId: UserId | null;
    toName: string | null;
  } | null;
  openReports: number;
  next: (GearAssignment & { name: string }) | null;
  retired: boolean;
};

/**
 * Every kit of the league with where it is right now, any handoff waiting,
 * its open reports and its next game: four queries for any number of kits.
 */
export async function leagueKits(
  db: Db,
  leagueId: LeagueId,
  now: Date,
  { withRetired = false }: { withRetired?: boolean } = {},
): Promise<KitRow[]> {
  const kits = await db
    .select({
      id: equipmentKit.id,
      name: equipmentKit.name,
      contents: equipmentKit.contents,
      homeLocation: equipmentKit.homeLocation,
      holderId: equipmentKit.holderId,
      retiredAt: equipmentKit.retiredAt,
    })
    .from(equipmentKit)
    .where(
      and(
        eq(equipmentKit.leagueId, leagueId),
        withRetired ? undefined : isNull(equipmentKit.retiredAt),
      ),
    )
    .orderBy(asc(equipmentKit.name));
  const ids = kits.map((k) => k.id);
  const [pending, reports, upcoming] = await Promise.all([
    pendingFor(db, ids),
    ids.length === 0
      ? []
      : db
          .select({
            kitId: equipmentReport.kitId,
            open: sql<number>`count(*)::int`,
          })
          .from(equipmentReport)
          .where(
            and(
              inArray(equipmentReport.kitId, ids),
              isNull(equipmentReport.resolvedAt),
            ),
          )
          .groupBy(equipmentReport.kitId),
    upcomingFor(db, ids, now),
  ]);
  const names = await namesOf(db, [
    ...kits.map((k) => k.holderId),
    ...pending.map((p) => p.toUserId),
    ...upcoming.map((a) => a.userId),
  ]);
  return kits.map((k) => {
    const p = pending.find((x) => x.kitId === k.id);
    const next = upcoming.find((a) => a.kitId === k.id);
    return {
      id: k.id,
      name: k.name,
      contents: k.contents,
      homeLocation: k.homeLocation,
      holderId: k.holderId,
      holderName: k.holderId ? (names.get(k.holderId) ?? null) : null,
      pending: p
        ? {
            id: p.id,
            fromUserId: p.fromUserId,
            toUserId: p.toUserId,
            toName: p.toUserId ? (names.get(p.toUserId) ?? null) : null,
          }
        : null,
      openReports: reports.find((r) => r.kitId === k.id)?.open ?? 0,
      next: next ? { ...next, name: names.get(next.userId) ?? "" } : null,
      retired: k.retiredAt !== null,
    };
  });
}

export type KitError = "not_found" | "name_taken";

const nameTaken = async (
  db: Db,
  leagueId: LeagueId,
  name: string,
  except?: EquipmentKitId,
) => {
  const [found] = await db
    .select({ id: equipmentKit.id })
    .from(equipmentKit)
    .where(
      and(
        eq(equipmentKit.leagueId, leagueId),
        sql`lower(${equipmentKit.name}) = lower(${name})`,
        except ? ne(equipmentKit.id, except) : undefined,
      ),
    )
    .limit(1);
  return found !== undefined;
};

/** Adds a kit, at its home. */
export async function createKit(
  db: Db,
  input: KitInput & { leagueId: LeagueId; actorId: UserId },
): Promise<Result<EquipmentKitId, KitError>> {
  if (await nameTaken(db, input.leagueId, input.name)) return err("name_taken");
  const [row] = await db
    .insert(equipmentKit)
    .values({
      leagueId: input.leagueId,
      name: input.name,
      contents: input.contents,
      homeLocation: input.homeLocation,
    })
    .returning({ id: equipmentKit.id });
  if (!row) throw new Error("Expected the new kit");
  await recordAudit(db, {
    actorId: input.actorId,
    action: "equipment.kit_create",
    entityType: "equipment_kit",
    entityId: row.id,
    after: {
      name: input.name,
      contents: input.contents,
      homeLocation: input.homeLocation,
    },
  });
  return ok(row.id);
}

/** Changes a kit's name, contents or home. */
export async function updateKit(
  db: Db,
  input: KitInput & {
    kitId: EquipmentKitId;
    leagueId: LeagueId;
    actorId: UserId;
  },
): Promise<Result<null, KitError>> {
  const locked = await lockKit(db, input.kitId);
  if (!locked || locked.kit.leagueId !== input.leagueId)
    return err("not_found");
  if (await nameTaken(db, input.leagueId, input.name, input.kitId))
    return err("name_taken");
  await db
    .update(equipmentKit)
    .set({
      name: input.name,
      contents: input.contents,
      homeLocation: input.homeLocation,
    })
    .where(eq(equipmentKit.id, input.kitId));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "equipment.kit_update",
    entityType: "equipment_kit",
    entityId: input.kitId,
    before: {
      name: locked.kit.name,
      contents: locked.kit.contents,
      homeLocation: locked.kit.homeLocation,
    },
    after: {
      name: input.name,
      contents: input.contents,
      homeLocation: input.homeLocation,
    },
  });
  return ok(null);
}

export type RetireError = "not_found" | "out";

/**
 * Takes a kit out of use. Only from its home with nothing waiting, so no
 * one is left holding a kit the league no longer tracks; its assignments to
 * games still to come are removed, and its history stays.
 */
export async function retireKit(
  db: Db,
  input: {
    kitId: EquipmentKitId;
    leagueId: LeagueId;
    actorId: UserId;
    now: Date;
  },
): Promise<Result<null, RetireError>> {
  const locked = await lockKit(db, input.kitId);
  if (!locked || locked.kit.leagueId !== input.leagueId || locked.state.retired)
    return err("not_found");
  if (locked.kit.holderId !== null || locked.pending) return err("out");
  const upcoming = await upcomingFor(db, [input.kitId], input.now);
  if (upcoming.length > 0)
    await db.delete(equipmentAssignment).where(
      inArray(
        equipmentAssignment.id,
        upcoming.map((a) => a.id),
      ),
    );
  await db
    .update(equipmentKit)
    .set({ retiredAt: input.now })
    .where(eq(equipmentKit.id, input.kitId));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "equipment.kit_retire",
    entityType: "equipment_kit",
    entityId: input.kitId,
    before: { kit: locked.kit.name },
    after: { unassigned: upcoming.length },
  });
  return ok(null);
}

// ---------------------------------------------------------------------------
// Assignments

/**
 * Games a kit can be assigned to: every game still on in the league's
 * current seasons over the next `days` days, soonest first.
 */
export async function upcomingGearGames(
  db: Db,
  leagueId: LeagueId,
  now: Date,
  { days = 21, gameId }: { days?: number; gameId?: GameId } = {},
): Promise<GearGame[]> {
  const until = new Date(now.getTime() + days * 86_400_000);
  const rows = await db
    .select(gameColumns)
    .from(game)
    .innerJoin(slot, eq(game.slotId, slot.id))
    .innerJoin(field, eq(slot.fieldId, field.id))
    .innerJoin(venue, eq(field.venueId, venue.id))
    .innerJoin(season, eq(game.seasonId, season.id))
    .innerJoin(league, eq(season.leagueId, league.id))
    .innerJoin(entryA, eq(game.teamAId, entryA.id))
    .innerJoin(teamA, eq(entryA.teamId, teamA.id))
    .innerJoin(entryB, eq(game.teamBId, entryB.id))
    .innerJoin(teamB, eq(entryB.teamId, teamB.id))
    .where(
      and(
        eq(league.id, leagueId),
        ne(season.status, "draft"),
        gameIsOn(now),
        gameId
          ? eq(game.id, gameId)
          : sql`${slot.startsAt} < ${until.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(asc(slot.startsAt), asc(field.name))
    .limit(200);
  return rows.map(asGame);
}

export type Candidate = {
  userId: UserId;
  name: string;
  role: "ref" | "captain" | "admin";
};

/**
 * Who can bring a kit to a game: its ref, the captains and co-captains of
 * both teams, and the league's admins. One query.
 */
export async function gearCandidates(
  db: Db,
  gameId: GameId,
): Promise<Candidate[]> {
  const [g] = await db
    .select({
      teamAId: game.teamAId,
      teamBId: game.teamBId,
      leagueId: season.leagueId,
    })
    .from(game)
    .innerJoin(season, eq(game.seasonId, season.id))
    .where(eq(game.id, gameId));
  if (!g) return [];
  const teams: TeamSeasonId[] = [g.teamAId, g.teamBId];
  // The game's own league's admins and owners (ADR 0048).
  const leagueAdmin = sql<boolean>`exists (
    select 1 from ${leagueMember}
    where ${leagueMember.leagueId} = ${g.leagueId}
      and ${leagueMember.userId} = ${user.id}
      and ${leagueMember.role} in ('admin', 'owner')
  )`;
  const rows = await db
    .select({
      userId: user.id,
      name: shortName,
      ref: sql<boolean>`exists (
        select 1 from ${refereeAssignment}
        where ${refereeAssignment.gameId} = ${gameId}
          and ${refereeAssignment.userId} = ${user.id}
          and ${refereeAssignment.status} = 'accepted'
      )`,
      captain: sql<boolean>`exists (
        select 1 from ${rosterMembership}
        join ${registration} on ${registration.id} = ${rosterMembership.registrationId}
        where ${registration.userId} = ${user.id}
          and ${rosterMembership.status} = 'active'
          and ${rosterMembership.role} in ('captain', 'co_captain')
          and ${rosterMembership.teamSeasonId} in (${sql.join(
            teams.map((t) => sql`${t}`),
            sql`, `,
          )})
      )`,
      admin: leagueAdmin,
    })
    .from(user)
    .leftJoin(profile, eq(profile.userId, user.id))
    .where(
      or(
        sql`exists (
          select 1 from ${refereeAssignment}
          where ${refereeAssignment.gameId} = ${gameId}
            and ${refereeAssignment.userId} = ${user.id}
            and ${refereeAssignment.status} = 'accepted'
        )`,
        sql`exists (
          select 1 from ${rosterMembership}
          join ${registration} on ${registration.id} = ${rosterMembership.registrationId}
          where ${registration.userId} = ${user.id}
            and ${rosterMembership.status} = 'active'
            and ${rosterMembership.role} in ('captain', 'co_captain')
            and ${rosterMembership.teamSeasonId} in (${sql.join(
              teams.map((t) => sql`${t}`),
              sql`, `,
            )})
        )`,
        leagueAdmin,
      ),
    )
    .orderBy(asc(shortName));
  const order = { ref: 0, captain: 1, admin: 2 };
  const roleOf = (r: { ref: boolean; captain: boolean }): Candidate["role"] =>
    r.ref ? "ref" : r.captain ? "captain" : "admin";
  return rows
    .map((r): Candidate => ({
      userId: r.userId,
      name: r.name,
      role: roleOf(r),
    }))
    .sort((a, b) => order[a.role] - order[b.role]);
}

export type AssignError =
  "not_found" | "retired" | "game_over" | "not_candidate" | "busy_that_day";

/**
 * Assigns a kit to a person for a game. One game a day per kit: a second
 * game on the same day replaces nothing and is refused. Assigning the same
 * game again to someone else moves it to them.
 */
export async function assignKit(
  db: Db,
  input: {
    kitId: EquipmentKitId;
    leagueId: LeagueId;
    gameId: GameId;
    userId: UserId;
    actorId: UserId;
    now: Date;
  },
): Promise<Result<EquipmentAssignmentId, AssignError>> {
  const locked = await lockKit(db, input.kitId);
  if (!locked || locked.kit.leagueId !== input.leagueId)
    return err("not_found");
  if (locked.state.retired) return err("retired");
  // Any game still on, however far ahead; the form offers three weeks.
  const [target] = await upcomingGearGames(db, input.leagueId, input.now, {
    gameId: input.gameId,
  });
  if (!target) return err("game_over");
  const candidates = await gearCandidates(db, input.gameId);
  if (!candidates.some((c) => c.userId === input.userId))
    return err("not_candidate");
  const day = sql`(${slot.startsAt} at time zone ${league.timezone})::date`;
  const sameDay = await assignmentsWhere(
    db,
    and(
      eq(equipmentAssignment.kitId, input.kitId),
      sql`${day} = (${target.startsAt.toISOString()}::timestamptz at time zone ${target.timeZone})::date`,
    ),
  );
  const other = sameDay.find((a) => a.gameId !== input.gameId);
  if (other) return err("busy_that_day");
  const existing = sameDay.find((a) => a.gameId === input.gameId);
  let id: EquipmentAssignmentId;
  if (existing) {
    await db
      .update(equipmentAssignment)
      .set({ userId: input.userId, assignedBy: input.actorId })
      .where(eq(equipmentAssignment.id, existing.id));
    id = existing.id;
  } else {
    const [row] = await db
      .insert(equipmentAssignment)
      .values({
        kitId: input.kitId,
        gameId: input.gameId,
        userId: input.userId,
        assignedBy: input.actorId,
      })
      .returning({ id: equipmentAssignment.id });
    if (!row) throw new Error("Expected the assignment");
    id = row.id;
  }
  await recordAudit(db, {
    actorId: input.actorId,
    action: "equipment.assign",
    entityType: "equipment_kit",
    entityId: input.kitId,
    before: existing ? { userId: existing.userId } : null,
    after: { kit: locked.kit.name, gameId: input.gameId, userId: input.userId },
  });
  return ok(id);
}

/** Takes a kit off a game. */
export async function unassignKit(
  db: Db,
  input: {
    assignmentId: EquipmentAssignmentId;
    leagueId: LeagueId;
    actorId: UserId;
  },
): Promise<Result<EquipmentKitId, "not_found">> {
  const [found] = await db
    .select({
      kitId: equipmentAssignment.kitId,
      gameId: equipmentAssignment.gameId,
      userId: equipmentAssignment.userId,
    })
    .from(equipmentAssignment)
    .where(eq(equipmentAssignment.id, input.assignmentId));
  if (!found) return err("not_found");
  const locked = await lockKit(db, found.kitId);
  if (!locked || locked.kit.leagueId !== input.leagueId)
    return err("not_found");
  await db
    .delete(equipmentAssignment)
    .where(eq(equipmentAssignment.id, input.assignmentId));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "equipment.unassign",
    entityType: "equipment_kit",
    entityId: found.kitId,
    before: {
      kit: locked.kit.name,
      gameId: found.gameId,
      userId: found.userId,
    },
  });
  return ok(found.kitId);
}

// ---------------------------------------------------------------------------
// The person with the gear

export type MyGearKit = {
  kitId: EquipmentKitId;
  kitName: string;
  contents: string[];
  homeLocation: string;
  holding: boolean;
  /** Who has it, when someone else does. */
  holderName: string | null;
  /** This person's next game with it, if they bring it to one. */
  game: GearAssignment | null;
  /** Who they hand it to next, if someone else brings it to a later game. */
  handTo: { userId: UserId; name: string } | null;
  /** A handoff waiting: from them, or to them. */
  pending: {
    id: EquipmentHandoffId;
    direction: "out" | "in";
    otherName: string;
  } | null;
};

/**
 * The kits this person has, is being handed, or brings to a game still to
 * come, with what they need to do next. Four queries, however many kits.
 */
export async function myGear(
  db: Db,
  userId: UserId,
  now: Date,
): Promise<MyGearKit[]> {
  const [held, incoming, mine] = await Promise.all([
    db
      .select({ id: equipmentKit.id })
      .from(equipmentKit)
      .where(
        and(eq(equipmentKit.holderId, userId), isNull(equipmentKit.retiredAt)),
      ),
    db
      .select({ kitId: equipmentHandoff.kitId })
      .from(equipmentHandoff)
      .where(
        and(
          eq(equipmentHandoff.toUserId, userId),
          eq(equipmentHandoff.status, "pending"),
        ),
      ),
    assignmentsWhere(
      db,
      and(eq(equipmentAssignment.userId, userId), gameIsOn(now)),
    ),
  ]);
  const kitIds = [
    ...new Set([
      ...held.map((k) => k.id),
      ...incoming.map((h) => h.kitId),
      ...mine.map((a) => a.kitId),
    ]),
  ];
  if (kitIds.length === 0) return [];
  const [kits, pending, upcoming] = await Promise.all([
    db
      .select({
        id: equipmentKit.id,
        name: equipmentKit.name,
        contents: equipmentKit.contents,
        homeLocation: equipmentKit.homeLocation,
        holderId: equipmentKit.holderId,
      })
      .from(equipmentKit)
      .where(
        and(inArray(equipmentKit.id, kitIds), isNull(equipmentKit.retiredAt)),
      )
      .orderBy(asc(equipmentKit.name)),
    pendingFor(db, kitIds),
    upcomingFor(db, kitIds, now),
  ]);
  const names = await namesOf(db, [
    ...kits.map((k) => k.holderId),
    ...pending.flatMap((p) => [p.fromUserId, p.toUserId]),
    ...upcoming.map((a) => a.userId),
  ]);
  return kits.map((k) => {
    const p = pending.find((x) => x.kitId === k.id);
    const assignments = upcoming.filter((a) => a.kitId === k.id);
    const holding = k.holderId === userId;
    const receiver = holding ? nextReceiver(assignments, userId, now) : null;
    const other = p
      ? p.toUserId === userId
        ? p.fromUserId
        : p.toUserId
      : null;
    return {
      kitId: k.id,
      kitName: k.name,
      contents: k.contents,
      homeLocation: k.homeLocation,
      holding,
      holderName:
        !holding && k.holderId ? (names.get(k.holderId) ?? null) : null,
      game: assignments.find((a) => a.userId === userId) ?? null,
      handTo: receiver
        ? { userId: receiver.userId, name: names.get(receiver.userId) ?? "" }
        : null,
      pending: p
        ? {
            id: p.id,
            direction: p.toUserId === userId ? "in" : "out",
            otherName: other
              ? (names.get(other) ?? "A former member")
              : "its home",
          }
        : null,
    };
  });
}

type HandoffInsert = {
  kitId: EquipmentKitId;
  fromUserId: UserId | null;
  toUserId: UserId | null;
  createdBy: UserId;
  now: Date;
};

const logHandoff = async (
  db: Db,
  h: HandoffInsert,
  status: "pending" | "confirmed",
) => {
  const [row] = await db
    .insert(equipmentHandoff)
    .values({
      kitId: h.kitId,
      fromUserId: h.fromUserId,
      toUserId: h.toUserId,
      status,
      createdBy: h.createdBy,
      createdAt: h.now,
      decidedAt: status === "confirmed" ? h.now : null,
    })
    .returning({ id: equipmentHandoff.id });
  if (!row) throw new Error("Expected the handoff");
  return row.id;
};

const moveKit = (db: Db, kitId: EquipmentKitId, holderId: UserId | null) =>
  db.update(equipmentKit).set({ holderId }).where(eq(equipmentKit.id, kitId));

export type GearError =
  | "not_found"
  | "retired"
  | "not_holder"
  | "pending"
  | "no_receiver"
  | "self"
  | "not_pending"
  | "not_receiver"
  | "not_giver"
  | "not_home"
  | "not_assigned";

/**
 * "I handed Kit A to Sam": the holder hands the kit to whoever brings it to
 * its next game. The kit stays theirs until Sam confirms.
 */
export async function handOffKit(
  db: Db,
  input: { kitId: EquipmentKitId; actorId: UserId; now: Date },
): Promise<Result<{ toUserId: UserId; kitName: string }, GearError>> {
  const locked = await lockKit(db, input.kitId);
  if (!locked) return err("not_found");
  const upcoming = await upcomingFor(db, [input.kitId], input.now);
  const receiver = nextReceiver(upcoming, input.actorId, input.now);
  const checked = checkHandOff(
    locked.state,
    input.actorId,
    receiver?.userId ?? null,
  );
  if (!checked.ok) return checked;
  const handoffId = await logHandoff(
    db,
    {
      kitId: input.kitId,
      fromUserId: input.actorId,
      toUserId: checked.value,
      createdBy: input.actorId,
      now: input.now,
    },
    "pending",
  );
  await recordAudit(db, {
    actorId: input.actorId,
    action: "equipment.hand_off",
    entityType: "equipment_handoff",
    entityId: handoffId,
    after: { kit: locked.kit.name, toUserId: checked.value },
  });
  return ok({ toUserId: checked.value, kitName: locked.kit.name });
}

/** Reads a handoff, then locks its kit. */
async function lockHandoff(db: Db, handoffId: EquipmentHandoffId) {
  const [h] = await db
    .select({ kitId: equipmentHandoff.kitId })
    .from(equipmentHandoff)
    .where(eq(equipmentHandoff.id, handoffId));
  if (!h) return null;
  const locked = await lockKit(db, h.kitId);
  if (!locked) return null;
  const [handoff] = await db
    .select({
      id: equipmentHandoff.id,
      status: equipmentHandoff.status,
      fromUserId: equipmentHandoff.fromUserId,
      toUserId: equipmentHandoff.toUserId,
    })
    .from(equipmentHandoff)
    .where(eq(equipmentHandoff.id, handoffId));
  return handoff ? { ...locked, handoff } : null;
}

/**
 * The receiver's answer: "Got it" moves the kit to them; "I don't have it"
 * leaves it with the giver.
 */
export async function answerHandoff(
  db: Db,
  input: {
    handoffId: EquipmentHandoffId;
    actorId: UserId;
    answer: "confirm" | "decline";
    now: Date;
  },
): Promise<Result<{ kitName: string }, GearError>> {
  const found = await lockHandoff(db, input.handoffId);
  if (!found) return err("not_found");
  const checked = checkAnswer(found.handoff, input.actorId);
  if (!checked.ok) return checked;
  const status = input.answer === "confirm" ? "confirmed" : "declined";
  await db
    .update(equipmentHandoff)
    .set({ status, decidedAt: input.now })
    .where(eq(equipmentHandoff.id, input.handoffId));
  if (input.answer === "confirm")
    await moveKit(db, found.kit.id, input.actorId);
  await recordAudit(db, {
    actorId: input.actorId,
    action:
      input.answer === "confirm"
        ? "equipment.handoff_confirm"
        : "equipment.handoff_decline",
    entityType: "equipment_handoff",
    entityId: input.handoffId,
    before: kitAudit(found.kit),
    after: {
      kit: found.kit.name,
      holderId: input.answer === "confirm" ? input.actorId : found.kit.holderId,
    },
  });
  return ok({ kitName: found.kit.name });
}

/** The giver takes back a handoff nobody has answered yet. */
export async function cancelHandoff(
  db: Db,
  input: { handoffId: EquipmentHandoffId; actorId: UserId; now: Date },
): Promise<Result<null, GearError>> {
  const found = await lockHandoff(db, input.handoffId);
  if (!found) return err("not_found");
  const checked = checkCancel(found.handoff, input.actorId);
  if (!checked.ok) return checked;
  await db
    .update(equipmentHandoff)
    .set({ status: "cancelled", decidedAt: input.now })
    .where(eq(equipmentHandoff.id, input.handoffId));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "equipment.handoff_cancel",
    entityType: "equipment_handoff",
    entityId: input.handoffId,
    before: { kit: found.kit.name, toUserId: found.handoff.toUserId },
  });
  return ok(null);
}

/** "I picked it up from home", by the person bringing it to a game. */
export async function pickUpKit(
  db: Db,
  input: { kitId: EquipmentKitId; actorId: UserId; now: Date },
): Promise<Result<{ kitName: string }, GearError>> {
  const locked = await lockKit(db, input.kitId);
  if (!locked) return err("not_found");
  const upcoming = await upcomingFor(db, [input.kitId], input.now);
  const checked = checkPickUp(
    locked.state,
    assignedNow(upcoming, input.actorId, input.now),
  );
  if (!checked.ok) return checked;
  const handoffId = await logHandoff(
    db,
    {
      kitId: input.kitId,
      fromUserId: null,
      toUserId: input.actorId,
      createdBy: input.actorId,
      now: input.now,
    },
    "confirmed",
  );
  await moveKit(db, input.kitId, input.actorId);
  await recordAudit(db, {
    actorId: input.actorId,
    action: "equipment.pick_up",
    entityType: "equipment_handoff",
    entityId: handoffId,
    before: kitAudit(locked.kit),
    after: { kit: locked.kit.name, holderId: input.actorId },
  });
  return ok({ kitName: locked.kit.name });
}

/** "It's back home", by its holder. */
export async function returnKitHome(
  db: Db,
  input: { kitId: EquipmentKitId; actorId: UserId; now: Date },
): Promise<Result<{ kitName: string }, GearError>> {
  const locked = await lockKit(db, input.kitId);
  if (!locked) return err("not_found");
  const checked = checkReturnHome(locked.state, input.actorId);
  if (!checked.ok) return checked;
  const handoffId = await logHandoff(
    db,
    {
      kitId: input.kitId,
      fromUserId: input.actorId,
      toUserId: null,
      createdBy: input.actorId,
      now: input.now,
    },
    "confirmed",
  );
  await moveKit(db, input.kitId, null);
  await recordAudit(db, {
    actorId: input.actorId,
    action: "equipment.return_home",
    entityType: "equipment_handoff",
    entityId: handoffId,
    before: kitAudit(locked.kit),
    after: { kit: locked.kit.name, holderId: null },
  });
  return ok({ kitName: locked.kit.name });
}

/**
 * An admin says where a kit really is: with someone, or at home (null).
 * Any handoff waiting is cancelled; the correction goes in the log.
 */
export async function setKitHolder(
  db: Db,
  input: {
    kitId: EquipmentKitId;
    leagueId: LeagueId;
    holderId: UserId | null;
    actorId: UserId;
    now: Date;
  },
): Promise<Result<null, "not_found" | "retired">> {
  const locked = await lockKit(db, input.kitId);
  if (!locked || locked.kit.leagueId !== input.leagueId)
    return err("not_found");
  if (locked.state.retired) return err("retired");
  if (input.holderId) {
    const [person] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, input.holderId));
    if (!person) return err("not_found");
  }
  if (locked.pending)
    await db
      .update(equipmentHandoff)
      .set({ status: "cancelled", decidedAt: input.now })
      .where(eq(equipmentHandoff.id, locked.pending.id));
  const handoffId = await logHandoff(
    db,
    {
      kitId: input.kitId,
      fromUserId: locked.kit.holderId,
      toUserId: input.holderId,
      createdBy: input.actorId,
      now: input.now,
    },
    "confirmed",
  );
  await moveKit(db, input.kitId, input.holderId);
  await recordAudit(db, {
    actorId: input.actorId,
    action: "equipment.set_holder",
    entityType: "equipment_handoff",
    entityId: handoffId,
    before: { ...kitAudit(locked.kit), pendingCancelled: !!locked.pending },
    after: { kit: locked.kit.name, holderId: input.holderId },
  });
  return ok(null);
}

// ---------------------------------------------------------------------------
// Missing items

/** A kit's name and contents, for the report form. */
export async function kitForReport(
  db: Db,
  kitId: EquipmentKitId,
): Promise<{ id: EquipmentKitId; name: string; contents: string[] } | null> {
  const [kit] = await db
    .select({
      id: equipmentKit.id,
      name: equipmentKit.name,
      contents: equipmentKit.contents,
    })
    .from(equipmentKit)
    .where(and(eq(equipmentKit.id, kitId), isNull(equipmentKit.retiredAt)));
  return kit ?? null;
}

/** Files a missing-items report, from someone with the kit or an admin. */
export async function reportMissing(
  db: Db,
  input: MissingReport & {
    kitId: EquipmentKitId;
    actorId: UserId;
    admin: boolean;
    now: Date;
  },
): Promise<Result<EquipmentReportId, "not_found" | "not_allowed">> {
  const locked = await lockKit(db, input.kitId);
  if (!locked || locked.state.retired) return err("not_found");
  const upcoming = await upcomingFor(db, [input.kitId], input.now);
  if (
    !mayReport(locked.state, input.actorId, {
      assigned: assignedNow(upcoming, input.actorId, input.now),
      admin: input.admin,
    })
  )
    return err("not_allowed");
  const [row] = await db
    .insert(equipmentReport)
    .values({
      kitId: input.kitId,
      reporterId: input.actorId,
      missing: input.missing,
      note: input.note,
      createdAt: input.now,
    })
    .returning({ id: equipmentReport.id });
  if (!row) throw new Error("Expected the report");
  await recordAudit(db, {
    actorId: input.actorId,
    action: "equipment.report_missing",
    entityType: "equipment_report",
    entityId: row.id,
    after: { kit: locked.kit.name, missing: input.missing, note: input.note },
  });
  return ok(row.id);
}

/** An admin marks a report sorted: restocked, found, or not needed. */
export async function resolveReport(
  db: Db,
  input: {
    reportId: EquipmentReportId;
    leagueId: LeagueId;
    actorId: UserId;
    now: Date;
  },
): Promise<Result<EquipmentKitId, "not_found">> {
  const [found] = await db
    .select({ kitId: equipmentReport.kitId })
    .from(equipmentReport)
    .innerJoin(equipmentKit, eq(equipmentReport.kitId, equipmentKit.id))
    .where(
      and(
        eq(equipmentReport.id, input.reportId),
        eq(equipmentKit.leagueId, input.leagueId),
        isNull(equipmentReport.resolvedAt),
      ),
    );
  if (!found) return err("not_found");
  await db
    .update(equipmentReport)
    .set({ resolvedAt: input.now, resolvedBy: input.actorId })
    .where(eq(equipmentReport.id, input.reportId));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "equipment.report_resolve",
    entityType: "equipment_report",
    entityId: input.reportId,
  });
  return ok(found.kitId);
}

// ---------------------------------------------------------------------------
// A kit's page, for admins

export type KitHistoryLine = {
  at: Date;
  kind:
    | "handoff_pending"
    | "handoff_confirmed"
    | "handoff_declined"
    | "handoff_cancelled"
    | "report"
    | "report_resolved";
  fromName: string | null;
  toName: string | null;
  byName: string | null;
  missing?: string[];
  note?: string | null;
};

export type KitDetail = {
  kit: KitRow;
  upcoming: (GearAssignment & { name: string })[];
  reports: {
    id: EquipmentReportId;
    missing: string[];
    note: string | null;
    reporterName: string | null;
    createdAt: Date;
  }[];
  history: KitHistoryLine[];
};

/**
 * One kit for its admin page: where it is, its games to come, its open
 * reports and its last 50 changes of hands and reports.
 */
export async function kitDetail(
  db: Db,
  leagueId: LeagueId,
  kitId: EquipmentKitId,
  now: Date,
): Promise<KitDetail | null> {
  const kits = await leagueKits(db, leagueId, now, { withRetired: true });
  const kit = kits.find((k) => k.id === kitId);
  if (!kit) return null;
  const [upcoming, handoffs, reports] = await Promise.all([
    upcomingFor(db, [kitId], now),
    db
      .select({
        status: equipmentHandoff.status,
        fromUserId: equipmentHandoff.fromUserId,
        toUserId: equipmentHandoff.toUserId,
        createdBy: equipmentHandoff.createdBy,
        createdAt: equipmentHandoff.createdAt,
        decidedAt: equipmentHandoff.decidedAt,
      })
      .from(equipmentHandoff)
      .where(eq(equipmentHandoff.kitId, kitId))
      .orderBy(desc(equipmentHandoff.createdAt))
      .limit(50),
    db
      .select({
        id: equipmentReport.id,
        missing: equipmentReport.missing,
        note: equipmentReport.note,
        reporterId: equipmentReport.reporterId,
        createdAt: equipmentReport.createdAt,
        resolvedAt: equipmentReport.resolvedAt,
        resolvedBy: equipmentReport.resolvedBy,
      })
      .from(equipmentReport)
      .where(eq(equipmentReport.kitId, kitId))
      .orderBy(desc(equipmentReport.createdAt))
      .limit(50),
  ]);
  const names = await namesOf(db, [
    ...upcoming.map((a) => a.userId),
    ...handoffs.flatMap((h) => [h.fromUserId, h.toUserId, h.createdBy]),
    ...reports.flatMap((r) => [r.reporterId, r.resolvedBy]),
  ]);
  const nameOf = (id: UserId | null) =>
    id ? (names.get(id) ?? "A former member") : null;
  const history: KitHistoryLine[] = [
    ...handoffs.map((h): KitHistoryLine => ({
      at: h.decidedAt ?? h.createdAt,
      kind: `handoff_${h.status}`,
      fromName: nameOf(h.fromUserId),
      toName: nameOf(h.toUserId),
      byName: nameOf(h.createdBy),
    })),
    ...reports.flatMap((r): KitHistoryLine[] => [
      {
        at: r.createdAt,
        kind: "report",
        fromName: null,
        toName: null,
        byName: nameOf(r.reporterId),
        missing: r.missing,
        note: r.note,
      },
      ...(r.resolvedAt
        ? [
            {
              at: r.resolvedAt,
              kind: "report_resolved" as const,
              fromName: null,
              toName: null,
              byName: nameOf(r.resolvedBy),
              missing: r.missing,
            },
          ]
        : []),
    ]),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 50);
  return {
    kit,
    upcoming: upcoming.map((a) => ({ ...a, name: names.get(a.userId) ?? "" })),
    reports: reports
      .filter((r) => r.resolvedAt === null)
      .map((r) => ({
        id: r.id,
        missing: r.missing,
        note: r.note,
        reporterName: nameOf(r.reporterId),
        createdAt: r.createdAt,
      })),
    history,
  };
}

// ---------------------------------------------------------------------------
// Game day

export type DayGear = {
  kitId: EquipmentKitId;
  kitName: string;
  gameId: GameId;
  place: string;
  bringBy: Date;
  teamAName: string;
  teamBName: string;
  bringerName: string;
  /** The person bringing it has it. */
  ready: boolean;
  holderName: string | null;
  pendingToName: string | null;
  openReports: number;
};

/**
 * The kits going to games on `date` (YYYY-MM-DD, league time), for the
 * command center: who brings each one, and whether they have it yet.
 */
export async function dayGear(
  db: Db,
  leagueId: LeagueId,
  date: string,
  now: Date,
): Promise<DayGear[]> {
  const day = sql`(${slot.startsAt} at time zone ${league.timezone})::date`;
  const assignments = await assignmentsWhere(
    db,
    and(eq(league.id, leagueId), sql`${day} = ${date}::date`),
  );
  if (assignments.length === 0) return [];
  const kits = await leagueKits(db, leagueId, now);
  const names = await namesOf(
    db,
    assignments.map((a) => a.userId),
  );
  return assignments.flatMap((a) => {
    const kit = kits.find((k) => k.id === a.kitId);
    if (!kit) return [];
    return [
      {
        kitId: a.kitId,
        kitName: kit.name,
        gameId: a.gameId,
        place: a.place,
        bringBy: bringBy(a.startsAt),
        teamAName: a.teamAName,
        teamBName: a.teamBName,
        bringerName: names.get(a.userId) ?? "A former member",
        ready: kit.holderId === a.userId,
        holderName: kit.holderName,
        pendingToName: kit.pending?.toName ?? null,
        openReports: kit.openReports,
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// The evening reminder

/**
 * Queues the evening reminder for everyone bringing a kit to a game
 * tomorrow (league time): what to bring, where, by when, and where to get
 * it. Once per assignment and game day, so running twice is harmless and a
 * game moved to another day gets a fresh reminder. Returns how many were
 * new.
 */
export async function queueGearReminders(db: Db, now: Date): Promise<number> {
  // Games in the next two days; remindsTonight picks tomorrow's.
  const until = new Date(now.getTime() + 2 * 86_400_000);
  const assignments = (
    await assignmentsWhere(
      db,
      and(
        gameIsOn(now),
        isNull(equipmentKit.retiredAt),
        sql`${slot.startsAt} < ${until.toISOString()}::timestamptz`,
      ),
    )
  ).filter((a) => remindsTonight(a.startsAt, now, a.timeZone));
  if (assignments.length === 0) return 0;
  const kitIds = [...new Set(assignments.map((a) => a.kitId))];
  const [kits, pending] = await Promise.all([
    db
      .select({
        id: equipmentKit.id,
        name: equipmentKit.name,
        homeLocation: equipmentKit.homeLocation,
        holderId: equipmentKit.holderId,
      })
      .from(equipmentKit)
      .where(inArray(equipmentKit.id, kitIds)),
    pendingFor(db, kitIds),
  ]);
  const names = await namesOf(
    db,
    kits.map((k) => k.holderId),
  );
  const messages: OutboxMessage[] = assignments.flatMap((a) => {
    const kit = kits.find((k) => k.id === a.kitId);
    if (!kit) return [];
    const p = pending.find((x) => x.kitId === a.kitId);
    const from: GearReminderPayload["from"] =
      kit.holderId === a.userId
        ? { kind: "holding" }
        : p?.toUserId === a.userId
          ? { kind: "on_its_way" }
          : kit.holderId
            ? { kind: "with", name: names.get(kit.holderId) ?? "its holder" }
            : { kind: "at_home", homeLocation: kit.homeLocation };
    const payload: GearReminderPayload = {
      kitName: kit.name,
      place: a.place,
      startsAt: a.startsAt.toISOString(),
      timeZone: a.timeZone,
      teams: `${a.teamAName} vs ${a.teamBName}`,
      from,
    };
    const day = a.startsAt.toISOString().slice(0, 10);
    return [
      {
        userId: a.userId,
        topic: "game_reminder",
        template: "gear_reminder",
        payload,
        dedupeKey: `gear_reminder:${a.id}:${day}`,
        sendAfter: now,
      },
    ];
  });
  return enqueueMessages(db, messages);
}

// ---------------------------------------------------------------------------
// The person's own data

/**
 * For a person's own export: the kits they have, the games they bring gear
 * to, the handoffs they were part of and the reports they filed.
 */
export async function myGearRecords(db: Db, userId: UserId) {
  const [holding, bringing, handoffs, reports] = await Promise.all([
    db
      .select({ kit: equipmentKit.name })
      .from(equipmentKit)
      .where(eq(equipmentKit.holderId, userId)),
    assignmentsWhere(db, eq(equipmentAssignment.userId, userId)),
    db
      .select({
        kit: equipmentKit.name,
        fromUserId: equipmentHandoff.fromUserId,
        toUserId: equipmentHandoff.toUserId,
        status: equipmentHandoff.status,
        createdAt: equipmentHandoff.createdAt,
        decidedAt: equipmentHandoff.decidedAt,
      })
      .from(equipmentHandoff)
      .innerJoin(equipmentKit, eq(equipmentHandoff.kitId, equipmentKit.id))
      .where(
        or(
          eq(equipmentHandoff.fromUserId, userId),
          eq(equipmentHandoff.toUserId, userId),
        ),
      )
      .orderBy(asc(equipmentHandoff.createdAt)),
    db
      .select({
        kit: equipmentKit.name,
        missing: equipmentReport.missing,
        note: equipmentReport.note,
        createdAt: equipmentReport.createdAt,
        resolvedAt: equipmentReport.resolvedAt,
      })
      .from(equipmentReport)
      .innerJoin(equipmentKit, eq(equipmentReport.kitId, equipmentKit.id))
      .where(eq(equipmentReport.reporterId, userId))
      .orderBy(asc(equipmentReport.createdAt)),
  ]);
  return {
    kitsYouHave: holding.map((k) => k.kit),
    gamesYouBringGearTo: bringing.map((a) => ({
      place: a.place,
      startsAt: a.startsAt,
      teams: `${a.teamAName} vs ${a.teamBName}`,
    })),
    handoffs: handoffs.map(({ fromUserId, toUserId, ...h }) => ({
      ...h,
      fromYou: fromUserId === userId,
      toYou: toUserId === userId,
    })),
    missingItemsReported: reports,
  };
}

/**
 * When a person deletes their account: they bring no gear to games still
 * to come, and a handoff waiting from or to them is cancelled. A kit they
 * hold stays theirs, so admins see it with "Deleted account" and can say
 * where it really is; the history stays.
 */
export async function releaseGearOf(db: Db, userId: UserId, now: Date) {
  const upcoming = await assignmentsWhere(
    db,
    and(eq(equipmentAssignment.userId, userId), gameIsOn(now)),
  );
  if (upcoming.length > 0)
    await db.delete(equipmentAssignment).where(
      inArray(
        equipmentAssignment.id,
        upcoming.map((a) => a.id),
      ),
    );
  await db
    .update(equipmentHandoff)
    .set({ status: "cancelled", decidedAt: now })
    .where(
      and(
        eq(equipmentHandoff.status, "pending"),
        or(
          eq(equipmentHandoff.fromUserId, userId),
          eq(equipmentHandoff.toUserId, userId),
        ),
      ),
    );
}
