import { and, asc, eq, ne, notInArray, sql } from "drizzle-orm";
import type { LeagueId, SeasonId } from "@/domain/ids";
import { user } from "../schema/auth";
import { field, game, slot, venue } from "../schema/game";
import { profile } from "../schema/profile";
import { permitWindow } from "../schema/schedule";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import type { Db } from "./schedule";

/**
 * The reads behind the permit renewal draft and the application packet
 * (ADR 0056). Owners only: pages check `books.manage` first. Player names
 * are read only when an owner asks for them in the packet.
 */

/** The season's held windows (not lost) and the league's fields. */
export async function renewalInputs(
  db: Db,
  leagueId: LeagueId,
  seasonId: SeasonId,
) {
  const place = sql<string>`${venue.name} || ', ' || ${field.name}`;
  const [windows, fields] = await Promise.all([
    db
      .select({
        fieldId: permitWindow.fieldId,
        place,
        startsAt: permitWindow.startsAt,
        endsAt: permitWindow.endsAt,
        status: permitWindow.status,
      })
      .from(permitWindow)
      .innerJoin(field, eq(field.id, permitWindow.fieldId))
      .innerJoin(venue, eq(venue.id, field.venueId))
      .where(
        and(
          eq(permitWindow.seasonId, seasonId),
          ne(permitWindow.status, "lost"),
        ),
      )
      .orderBy(asc(permitWindow.startsAt)),
    db
      .select({
        id: field.id,
        name: field.name,
        place,
        lat: venue.lat,
        lng: venue.lng,
      })
      .from(field)
      .innerJoin(venue, eq(venue.id, field.venueId))
      .where(eq(venue.leagueId, leagueId))
      .orderBy(asc(venue.name), asc(field.sortOrder), asc(field.name)),
  ]);
  return {
    windows,
    fields: fields.map((f) => ({
      id: f.id,
      name: f.name,
      place: f.place,
      venue:
        f.lat !== null && f.lng !== null
          ? { lat: Number(f.lat), lng: Number(f.lng) }
          : null,
    })),
  };
}

const PLAYING = ["waitlisted", "withdrawn"] as const;

/**
 * What NYC Parks may ask about the season's schedule and rosters, as
 * counts: teams in it, players on their rosters, games not called off and
 * the days they are played, in the league's time zone.
 */
export async function packetCounts(
  db: Db,
  seasonId: SeasonId,
  timeZone: string,
) {
  const [teams, players, games] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(teamSeason)
      .where(
        and(
          eq(teamSeason.seasonId, seasonId),
          notInArray(teamSeason.status, [...PLAYING]),
        ),
      ),
    db
      .select({
        count: sql<number>`count(distinct ${registration.userId})::int`,
      })
      .from(rosterMembership)
      .innerJoin(teamSeason, eq(teamSeason.id, rosterMembership.teamSeasonId))
      .innerJoin(
        registration,
        eq(registration.id, rosterMembership.registrationId),
      )
      .where(
        and(
          eq(teamSeason.seasonId, seasonId),
          eq(rosterMembership.status, "active"),
          notInArray(teamSeason.status, [...PLAYING]),
        ),
      ),
    db
      .select({
        games: sql<number>`count(*)::int`,
        days: sql<number>`count(distinct (${slot.startsAt} at time zone ${timeZone})::date)::int`,
      })
      .from(game)
      .innerJoin(slot, eq(slot.id, game.slotId))
      .where(
        and(
          eq(game.seasonId, seasonId),
          notInArray(game.status, ["cancelled", "postponed"]),
        ),
      ),
  ]);
  return {
    teams: teams[0]?.count ?? 0,
    players: players[0]?.count ?? 0,
    games: games[0]?.games ?? 0,
    gameDays: games[0]?.days ?? 0,
  };
}

/**
 * Each team's active roster with names, for an owner who chooses to send
 * NYC Parks the rosters. Names only: no contact details.
 */
export async function packetRosters(db: Db, seasonId: SeasonId) {
  const rows = await db
    .select({
      teamSeasonId: teamSeason.id,
      team: team.name,
      name: sql<string>`coalesce(nullif(trim(coalesce(${profile.firstName}, '') || ' ' || coalesce(${profile.lastName}, '')), ''), nullif(${user.name}, ''), 'Player')`,
    })
    .from(rosterMembership)
    .innerJoin(teamSeason, eq(teamSeason.id, rosterMembership.teamSeasonId))
    .innerJoin(team, eq(team.id, teamSeason.teamId))
    .innerJoin(
      registration,
      eq(registration.id, rosterMembership.registrationId),
    )
    .innerJoin(user, eq(user.id, registration.userId))
    .leftJoin(profile, eq(profile.userId, registration.userId))
    .where(
      and(
        eq(teamSeason.seasonId, seasonId),
        eq(rosterMembership.status, "active"),
        notInArray(teamSeason.status, [...PLAYING]),
      ),
    )
    .orderBy(asc(team.name));
  const teams = new Map<string, { team: string; players: string[] }>();
  for (const r of rows) {
    const t = teams.get(r.teamSeasonId) ?? { team: r.team, players: [] };
    t.players.push(r.name);
    teams.set(r.teamSeasonId, t);
  }
  return [...teams.values()].map((t) => ({
    ...t,
    players: [...t.players].sort((a, b) => a.localeCompare(b)),
  }));
}
