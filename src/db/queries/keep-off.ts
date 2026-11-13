import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import type {
  KeepOffId,
  LeagueId,
  RegistrationId,
  SeasonId,
  TeamId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import { user } from "../schema/auth";
import { teamKeepOff } from "../schema/keep-off";
import { league } from "../schema/league";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { recordAudit } from "./audit";
import type { Db } from "./schedule";

/**
 * A team's private "not on my team" list (ADR 0036). The rules are in
 * src/domain/keep-off; this file reads and writes the rows. The audit log
 * records who added or removed whom, never the reason, so deleting either
 * account takes the reason with it.
 */

/** "Jo Smith", or the account name, or the address, for captains and admins. */
const fullName = sql<string>`coalesce(nullif(trim(coalesce(${profile.firstName}, '') || ' ' || coalesce(${profile.lastName}, '')), ''), nullif(${user.name}, ''), ${user.email})`;

/** The lasting team a season's entry belongs to. */
export async function teamOfSeason(
  db: Db,
  teamSeasonId: TeamSeasonId,
): Promise<{ teamId: TeamId; teamName: string; leagueId: LeagueId } | null> {
  const [row] = await db
    .select({ teamId: team.id, teamName: team.name, leagueId: team.leagueId })
    .from(teamSeason)
    .innerJoin(team, eq(teamSeason.teamId, team.id))
    .where(eq(teamSeason.id, teamSeasonId));
  return row ?? null;
}

export type KeepOffRow = {
  id: KeepOffId;
  userId: UserId;
  name: string;
  email: string;
  reason: string | null;
  addedAt: Date;
};

/**
 * One team's list, for its captains: name, address, reason, oldest first.
 * Read through any of the team's seasons; the list is the lasting team's.
 */
export async function teamKeepOffList(
  db: Db,
  teamSeasonId: TeamSeasonId,
): Promise<KeepOffRow[]> {
  return db
    .select({
      id: teamKeepOff.id,
      userId: teamKeepOff.userId,
      name: fullName,
      email: user.email,
      reason: teamKeepOff.reason,
      addedAt: teamKeepOff.createdAt,
    })
    .from(teamSeason)
    .innerJoin(teamKeepOff, eq(teamKeepOff.teamId, teamSeason.teamId))
    .innerJoin(user, eq(teamKeepOff.userId, user.id))
    .leftJoin(profile, eq(profile.userId, user.id))
    .where(eq(teamSeason.id, teamSeasonId))
    .orderBy(asc(teamKeepOff.createdAt), asc(teamKeepOff.id));
}

export type AddError =
  "not_found" | "self" | "on_team" | "already_listed" | "reason_too_long";

/**
 * Adds the league member with `email` to the team's list. Refuses the
 * person adding (a captain can't list themselves) and anyone on the team's
 * roster in a season not over yet, who has to leave the team through the
 * league first.
 */
export async function addKeepOff(
  db: Db,
  input: {
    teamId: TeamId;
    email: string;
    reason: string | null;
    actorId: UserId;
    now: Date;
  },
): Promise<Result<KeepOffId, AddError>> {
  const [person] = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = ${input.email.toLowerCase()}`);
  if (!person) return err("not_found");
  if (person.id === input.actorId) return err("self");
  const [onTeam] = await db
    .select({ id: rosterMembership.id })
    .from(rosterMembership)
    .innerJoin(
      registration,
      eq(rosterMembership.registrationId, registration.id),
    )
    .innerJoin(teamSeason, eq(rosterMembership.teamSeasonId, teamSeason.id))
    .innerJoin(season, eq(teamSeason.seasonId, season.id))
    .where(
      and(
        eq(teamSeason.teamId, input.teamId),
        eq(registration.userId, person.id),
        eq(rosterMembership.status, "active"),
        ne(season.status, "completed"),
      ),
    )
    .limit(1);
  if (onTeam) return err("on_team");
  const [created] = await db
    .insert(teamKeepOff)
    .values({
      teamId: input.teamId,
      userId: person.id,
      reason: input.reason,
      addedBy: input.actorId,
      createdAt: input.now,
    })
    .onConflictDoNothing()
    .returning({ id: teamKeepOff.id });
  if (!created) return err("already_listed");
  await recordAudit(db, {
    actorId: input.actorId,
    action: "keep_off.add",
    entityType: "team",
    entityId: input.teamId,
    after: { userId: person.id, withReason: input.reason !== null },
  });
  return ok(created.id);
}

/** Takes one entry off a team's list. `teamId` scopes it to that team. */
export async function removeKeepOff(
  db: Db,
  input: { id: KeepOffId; teamId: TeamId | null; actorId: UserId },
): Promise<Result<void, "not_found">> {
  const [removed] = await db
    .delete(teamKeepOff)
    .where(
      and(
        eq(teamKeepOff.id, input.id),
        input.teamId ? eq(teamKeepOff.teamId, input.teamId) : undefined,
      ),
    )
    .returning({ teamId: teamKeepOff.teamId, userId: teamKeepOff.userId });
  if (!removed) return err("not_found");
  await recordAudit(db, {
    actorId: input.actorId,
    action: "keep_off.remove",
    entityType: "team",
    entityId: removed.teamId,
    before: { userId: removed.userId },
  });
  return ok(undefined);
}

/** The team an entry is on, so the caller can check permissions. */
export async function keepOffTeam(
  db: Db,
  id: KeepOffId,
): Promise<TeamId | null> {
  const [row] = await db
    .select({ teamId: teamKeepOff.teamId })
    .from(teamKeepOff)
    .where(eq(teamKeepOff.id, id));
  return row?.teamId ?? null;
}

/** Whether the team behind `teamSeasonId` keeps `userId` off. */
export async function isKeptOff(
  db: Db,
  teamSeasonId: TeamSeasonId,
  userId: UserId,
): Promise<boolean> {
  const [row] = await db
    .select({ id: teamKeepOff.id })
    .from(teamKeepOff)
    .innerJoin(teamSeason, eq(teamSeason.teamId, teamKeepOff.teamId))
    .where(
      and(eq(teamSeason.id, teamSeasonId), eq(teamKeepOff.userId, userId)),
    );
  return row !== undefined;
}

/**
 * For the sub finder: which of `teamSeasonIds` keep each of `userIds` off,
 * in one query. People on no list are missing from the map.
 */
export async function keptOffAmong(
  db: Db,
  teamSeasonIds: readonly TeamSeasonId[],
  userIds: readonly UserId[],
): Promise<Map<UserId, TeamSeasonId[]>> {
  const result = new Map<UserId, TeamSeasonId[]>();
  if (teamSeasonIds.length === 0 || userIds.length === 0) return result;
  const rows = await db
    .select({ userId: teamKeepOff.userId, teamSeasonId: teamSeason.id })
    .from(teamKeepOff)
    .innerJoin(teamSeason, eq(teamSeason.teamId, teamKeepOff.teamId))
    .where(
      and(
        inArray(teamSeason.id, [...teamSeasonIds]),
        inArray(teamKeepOff.userId, [...userIds]),
      ),
    );
  for (const r of rows)
    result.set(r.userId, [...(result.get(r.userId) ?? []), r.teamSeasonId]);
  return result;
}

/**
 * For the matcher: each of the season's teams and the registrations its
 * list keeps off, in one query.
 */
export async function keptOffRegistrations(
  db: Db,
  seasonId: SeasonId,
): Promise<Map<TeamSeasonId, RegistrationId[]>> {
  const rows = await db
    .select({ teamSeasonId: teamSeason.id, registrationId: registration.id })
    .from(teamKeepOff)
    .innerJoin(teamSeason, eq(teamSeason.teamId, teamKeepOff.teamId))
    .innerJoin(
      registration,
      and(
        eq(registration.userId, teamKeepOff.userId),
        eq(registration.seasonId, teamSeason.seasonId),
      ),
    )
    .where(eq(teamSeason.seasonId, seasonId));
  const result = new Map<TeamSeasonId, RegistrationId[]>();
  for (const r of rows)
    result.set(r.teamSeasonId, [
      ...(result.get(r.teamSeasonId) ?? []),
      r.registrationId,
    ]);
  return result;
}

/** Whether `teamSeasonId`'s list keeps the person behind a registration off. */
export async function keepsRegistrationOff(
  db: Db,
  teamSeasonId: TeamSeasonId,
  registrationId: RegistrationId,
): Promise<boolean> {
  const [row] = await db
    .select({ id: teamKeepOff.id })
    .from(registration)
    .innerJoin(teamKeepOff, eq(teamKeepOff.userId, registration.userId))
    .innerJoin(teamSeason, eq(teamSeason.teamId, teamKeepOff.teamId))
    .where(
      and(eq(registration.id, registrationId), eq(teamSeason.id, teamSeasonId)),
    );
  return row !== undefined;
}

export type LeagueKeepOffRow = KeepOffRow & {
  teamId: TeamId;
  teamName: string;
  addedByName: string | null;
};

/** Every team's list in the league, for the admin oversight page. */
export async function leagueKeepOffs(
  db: Db,
  leagueId: LeagueId,
): Promise<LeagueKeepOffRow[]> {
  const rows = await db
    .select({
      id: teamKeepOff.id,
      teamId: team.id,
      teamName: team.name,
      userId: teamKeepOff.userId,
      name: fullName,
      email: user.email,
      reason: teamKeepOff.reason,
      addedAt: teamKeepOff.createdAt,
      addedBy: teamKeepOff.addedBy,
    })
    .from(teamKeepOff)
    .innerJoin(team, eq(teamKeepOff.teamId, team.id))
    .innerJoin(user, eq(teamKeepOff.userId, user.id))
    .leftJoin(profile, eq(profile.userId, user.id))
    .where(eq(team.leagueId, leagueId))
    .orderBy(asc(team.name), asc(teamKeepOff.createdAt), asc(teamKeepOff.id));
  const adders = [...new Set(rows.flatMap((r) => r.addedBy ?? []))];
  const names =
    adders.length === 0
      ? []
      : await db
          .select({ id: user.id, name: fullName })
          .from(user)
          .leftJoin(profile, eq(profile.userId, user.id))
          .where(inArray(user.id, adders));
  return rows.map(({ addedBy, ...r }) => ({
    ...r,
    addedByName: names.find((n) => n.id === addedBy)?.name ?? null,
  }));
}

/** The league's teams, for the admin's "add to a team's list" form. */
export async function leagueTeams(db: Db, leagueId: LeagueId) {
  return db
    .select({ id: team.id, name: team.name })
    .from(team)
    .where(and(eq(team.leagueId, leagueId), sql`${team.deletedAt} is null`))
    .orderBy(asc(team.name));
}

/** Whether a person's own export lists entries about them (owners decide). */
export async function exportsKeepOffEntries(db: Db): Promise<boolean> {
  const [row] = await db
    .select({ on: league.exportKeepOffEntries })
    .from(league)
    .orderBy(asc(league.createdAt))
    .limit(1);
  return row?.on ?? false;
}

/** The owners' choice for the league, audited. */
export async function setExportKeepOffEntries(
  db: Db,
  input: { leagueId: LeagueId; on: boolean; actorId: UserId },
): Promise<void> {
  const [before] = await db
    .select({ on: league.exportKeepOffEntries })
    .from(league)
    .where(eq(league.id, input.leagueId));
  if (!before || before.on === input.on) return;
  await db
    .update(league)
    .set({ exportKeepOffEntries: input.on })
    .where(eq(league.id, input.leagueId));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "keep_off.export_policy",
    entityType: "league",
    entityId: input.leagueId,
    before: { listedInOwnExport: before.on },
    after: { listedInOwnExport: input.on },
  });
}

/**
 * For a person's own export: the entries they added as a captain or admin,
 * always, and the entries about them only when the league's owners chose
 * to include them (ADR 0036).
 */
export async function myKeepOffEntries(
  db: Db,
  userId: UserId,
  includeAboutMe: boolean,
) {
  const rows = await db
    .select({
      teamName: team.name,
      userId: teamKeepOff.userId,
      addedBy: teamKeepOff.addedBy,
      name: fullName,
      reason: teamKeepOff.reason,
      addedAt: teamKeepOff.createdAt,
    })
    .from(teamKeepOff)
    .innerJoin(team, eq(teamKeepOff.teamId, team.id))
    .innerJoin(user, eq(teamKeepOff.userId, user.id))
    .leftJoin(profile, eq(profile.userId, user.id))
    .where(
      includeAboutMe
        ? or(eq(teamKeepOff.addedBy, userId), eq(teamKeepOff.userId, userId))
        : eq(teamKeepOff.addedBy, userId),
    )
    .orderBy(asc(teamKeepOff.createdAt));
  return {
    added: rows
      .filter((r) => r.addedBy === userId)
      .map((r) => ({
        team: r.teamName,
        person: r.name,
        reason: r.reason,
        addedAt: r.addedAt,
      })),
    ...(includeAboutMe
      ? {
          aboutYou: rows
            .filter((r) => r.userId === userId)
            .map((r) => ({
              team: r.teamName,
              reason: r.reason,
              addedAt: r.addedAt,
            })),
        }
      : {}),
  };
}

/** Account deletion: every entry about the person and every one they added. */
export async function removeKeepOffsFor(db: Db, userId: UserId) {
  await db
    .delete(teamKeepOff)
    .where(or(eq(teamKeepOff.userId, userId), eq(teamKeepOff.addedBy, userId)));
}

/**
 * An admin placing someone a team keeps off, on purpose: recorded on its
 * own so the audit log shows the override next to the placement.
 */
export async function recordKeepOffOverride(
  db: Db,
  input: {
    registrationId: RegistrationId;
    teamSeasonId: TeamSeasonId;
    actorId: UserId;
  },
) {
  await recordAudit(db, {
    actorId: input.actorId,
    action: "keep_off.override",
    entityType: "registration",
    entityId: input.registrationId,
    after: { teamSeasonId: input.teamSeasonId },
  });
}
