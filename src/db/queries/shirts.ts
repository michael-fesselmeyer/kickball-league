import { and, eq, ne } from "drizzle-orm";
import type {
  RegistrationId,
  SeasonId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import type { ShirtSize, ShirtStatus } from "@/domain/shirts/summary";
import { user } from "../schema/auth";
import { profile } from "../schema/profile";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { recordAudit } from "./audit";
import type { Db } from "./schedule";

/**
 * Shirt tracking for a season: each player's size (from their profile) and
 * shirt status (registration.shirt_status), grouped by team.
 */

export type ShirtPlayer = {
  registrationId: RegistrationId;
  name: string;
  size: ShirtSize | null;
  status: ShirtStatus;
};

export type ShirtTeam = {
  teamSeasonId: TeamSeasonId;
  name: string;
  colorHex: string | null;
  players: ShirtPlayer[];
};

export async function shirtBoard(
  db: Db,
  seasonId: SeasonId,
): Promise<{ teams: ShirtTeam[]; freeAgents: ShirtPlayer[] }> {
  const people = await db
    .select({
      registrationId: registration.id,
      status: registration.shirtStatus,
      size: profile.shirtSize,
      firstName: profile.firstName,
      lastName: profile.lastName,
      accountName: user.name,
    })
    .from(registration)
    .innerJoin(user, eq(registration.userId, user.id))
    .leftJoin(profile, eq(profile.userId, user.id))
    .where(
      and(
        eq(registration.seasonId, seasonId),
        ne(registration.status, "cancelled"),
      ),
    );
  const spots = await db
    .select({
      registrationId: rosterMembership.registrationId,
      teamSeasonId: teamSeason.id,
      name: team.name,
      colorHex: team.colorHex,
    })
    .from(rosterMembership)
    .innerJoin(teamSeason, eq(rosterMembership.teamSeasonId, teamSeason.id))
    .innerJoin(team, eq(teamSeason.teamId, team.id))
    .where(
      and(
        eq(teamSeason.seasonId, seasonId),
        eq(rosterMembership.status, "active"),
      ),
    );
  const teamOf = new Map(spots.map((s) => [s.registrationId, s]));
  const teams = new Map<TeamSeasonId, ShirtTeam>();
  const freeAgents: ShirtPlayer[] = [];
  for (const p of people) {
    const player: ShirtPlayer = {
      registrationId: p.registrationId,
      name:
        p.firstName && p.lastName
          ? `${p.firstName} ${p.lastName}`
          : p.accountName || "New player",
      size: p.size,
      status: p.status,
    };
    const spot = teamOf.get(p.registrationId);
    if (!spot) {
      freeAgents.push(player);
      continue;
    }
    const entry = teams.get(spot.teamSeasonId) ?? {
      teamSeasonId: spot.teamSeasonId,
      name: spot.name,
      colorHex: spot.colorHex,
      players: [],
    };
    entry.players.push(player);
    teams.set(spot.teamSeasonId, entry);
  }
  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name);
  return {
    teams: [...teams.values()]
      .map((t) => ({ ...t, players: t.players.sort(byName) }))
      .sort(byName),
    freeAgents: freeAgents.sort(byName),
  };
}

/** Sets one player's shirt status for the season, with an audit row. */
export async function setShirtStatus(
  db: Db,
  input: {
    seasonId: SeasonId;
    registrationId: RegistrationId;
    status: ShirtStatus;
    actorId: UserId;
  },
): Promise<Result<void, "unknown_registration">> {
  const [before] = await db
    .select({ status: registration.shirtStatus })
    .from(registration)
    .where(
      and(
        eq(registration.id, input.registrationId),
        eq(registration.seasonId, input.seasonId),
      ),
    );
  if (!before) return err("unknown_registration");
  if (before.status === input.status) return ok(undefined);
  await db
    .update(registration)
    .set({ shirtStatus: input.status })
    .where(eq(registration.id, input.registrationId));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "shirts.set_status",
    entityType: "registration",
    entityId: input.registrationId,
    before: { shirtStatus: before.status },
    after: { shirtStatus: input.status },
  });
  return ok(undefined);
}

/** Marks every player on a team whose shirt is not ordered yet as ordered. */
export async function markTeamOrdered(
  db: Db,
  input: { seasonId: SeasonId; teamSeasonId: TeamSeasonId; actorId: UserId },
): Promise<number> {
  const members = await db
    .select({ registrationId: registration.id })
    .from(rosterMembership)
    .innerJoin(
      registration,
      eq(rosterMembership.registrationId, registration.id),
    )
    .innerJoin(teamSeason, eq(rosterMembership.teamSeasonId, teamSeason.id))
    .where(
      and(
        eq(rosterMembership.teamSeasonId, input.teamSeasonId),
        eq(rosterMembership.status, "active"),
        eq(teamSeason.seasonId, input.seasonId),
        eq(registration.shirtStatus, "none"),
        ne(registration.status, "cancelled"),
      ),
    );
  for (const m of members)
    await setShirtStatus(db, {
      seasonId: input.seasonId,
      registrationId: m.registrationId,
      status: "ordered",
      actorId: input.actorId,
    });
  return members.length;
}
