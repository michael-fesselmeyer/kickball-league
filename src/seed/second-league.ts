import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/queries/schedule";
import { field, game, slot, venue } from "@/db/schema/game";
import { fieldLayout } from "@/db/schema/field-layout";
import { league, leagueMember } from "@/db/schema/league";
import { scheduleVersion } from "@/db/schema/schedule";
import { season } from "@/db/schema/season";
import { ruleSet } from "@/db/schema/division";
import { auditLog } from "@/db/schema/audit";
import { user } from "@/db/schema/auth";
import { profile } from "@/db/schema/profile";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "@/db/schema/team";
import type {
  FieldId,
  GameId,
  LeagueId,
  RegistrationId,
  RuleSetId,
  SeasonId,
  SlotId,
  TeamId,
  TeamSeasonId,
  UserId,
  VenueId,
} from "@/domain/ids";
import { PERSONA_IDS } from "./demo-personas";
import { newYorkTime, roundRobin, SEED_EMAIL_DOMAIN } from "./generate";
import { seedPublishedSchedule } from "./published-schedule";

/**
 * A second, smaller league on the same deployment (ADR 0048): a flag
 * football league with its own admin, teams, season and published schedule.
 * Its season and one team share their slugs with the kickball league's on
 * purpose, so the tests show the two never mix. The demo player also plays
 * here, so the app shows them the league switcher. Everything is invented.
 */
export const SECOND_LEAGUE_SLUG = "flag-football";

/** Fixed ids, so the tests can name them. */
const fixed = <T extends string>(n: number) =>
  `f0070000-0000-4000-8000-${String(n).padStart(12, "0")}` as T;

export const SECOND_LEAGUE = {
  id: fixed<LeagueId>(1),
  name: "Sunday Flag Football (demo)",
  slug: SECOND_LEAGUE_SLUG,
  sport: "football",
  timezone: "America/New_York",
  minimumAge: 21,
  branding: { primaryColor: "#14532D", secondaryColor: "#F5B301" },
};

/** Its admin, who has no role in the kickball league. */
export const SECOND_LEAGUE_ADMIN = {
  id: fixed<UserId>(2),
  first: "Frankie",
  last: "Fieldgoal",
  email: `frankie.fieldgoal@${SEED_EMAIL_DOMAIN}`,
};

const TEAMS = [
  // The same slug as a kickball team, on purpose.
  { name: "The Big Kicks", slug: "the-big-kicks", color: "#14532D" },
  { name: "Red Zone Regulars", slug: "red-zone-regulars", color: "#B91C1C" },
  { name: "Hail Marys", slug: "hail-marys", color: "#1D4ED8" },
  { name: "Sunday Scramblers", slug: "sunday-scramblers", color: null },
] as const;

const GAME_DAYS = ["2026-09-13", "2026-09-20", "2026-09-27"] as const;

/** Removes the second league and everything in it, children first. */
export async function removeSecondLeague(db: Db): Promise<void> {
  const [found] = await db
    .select({ id: league.id })
    .from(league)
    .where(eq(league.slug, SECOND_LEAGUE_SLUG));
  if (!found) return;
  const seasons = (
    await db
      .select({ id: season.id })
      .from(season)
      .where(eq(season.leagueId, found.id))
  ).map((s) => s.id);
  if (seasons.length > 0) {
    // Placements cascade with their versions.
    await db
      .delete(scheduleVersion)
      .where(inArray(scheduleVersion.seasonId, seasons));
    await db.delete(game).where(inArray(game.seasonId, seasons));
    await db.delete(slot).where(inArray(slot.seasonId, seasons));
    const entries = (
      await db
        .select({ id: registration.id })
        .from(registration)
        .where(inArray(registration.seasonId, seasons))
    ).map((r) => r.id);
    if (entries.length > 0)
      await db
        .delete(rosterMembership)
        .where(inArray(rosterMembership.registrationId, entries));
    await db
      .delete(registration)
      .where(inArray(registration.seasonId, seasons));
    await db.delete(teamSeason).where(inArray(teamSeason.seasonId, seasons));
    await db.delete(season).where(inArray(season.id, seasons));
  }
  await db.delete(team).where(eq(team.leagueId, found.id));
  const venues = (
    await db
      .select({ id: venue.id })
      .from(venue)
      .where(eq(venue.leagueId, found.id))
  ).map((v) => v.id);
  if (venues.length > 0)
    await db.delete(field).where(inArray(field.venueId, venues));
  await db.delete(venue).where(eq(venue.leagueId, found.id));
  await db.delete(ruleSet).where(eq(ruleSet.leagueId, found.id));
  await db.delete(auditLog).where(eq(auditLog.leagueId, found.id));
  // Roles cascade with the league.
  await db.delete(league).where(eq(league.id, found.id));
  await db.delete(user).where(eq(user.id, SECOND_LEAGUE_ADMIN.id));
}

/** Adds the second league after the kickball league is seeded. */
export async function addSecondLeague(db: Db): Promise<void> {
  await db.insert(league).values({ ...SECOND_LEAGUE, isDefault: false });
  await db.insert(ruleSet).values({
    id: fixed<RuleSetId>(3),
    leagueId: SECOND_LEAGUE.id,
    name: "Standard",
    timeLimitMinutes: 50,
  });

  await db.insert(user).values({
    id: SECOND_LEAGUE_ADMIN.id,
    name: `${SECOND_LEAGUE_ADMIN.first} ${SECOND_LEAGUE_ADMIN.last}`,
    email: SECOND_LEAGUE_ADMIN.email,
    emailVerified: true,
  });
  await db.insert(profile).values({
    userId: SECOND_LEAGUE_ADMIN.id,
    firstName: SECOND_LEAGUE_ADMIN.first,
    lastName: SECOND_LEAGUE_ADMIN.last,
  });
  await db.insert(leagueMember).values({
    leagueId: SECOND_LEAGUE.id,
    userId: SECOND_LEAGUE_ADMIN.id,
    role: "admin",
  });

  const fall: {
    id: SeasonId;
    leagueId: LeagueId;
    name: string;
    slug: string;
    status: "in_progress";
    startsOn: string;
    endsOn: string;
    feeModel: "per_player";
    playerFeeCents: number;
    freeAgentFeeCents: number;
    rosterMin: number;
    rosterMax: number;
  } = {
    id: fixed<SeasonId>(4),
    leagueId: SECOND_LEAGUE.id,
    name: "Fall 2026",
    // The same slug as the kickball league's season, on purpose.
    slug: "fall-2026",
    status: "in_progress",
    startsOn: GAME_DAYS[0],
    endsOn: GAME_DAYS[2],
    feeModel: "per_player",
    playerFeeCents: 6000,
    freeAgentFeeCents: 6000,
    rosterMin: 1,
    rosterMax: 12,
  };
  await db.insert(season).values(fall);

  const venueId = fixed<VenueId>(5);
  await db.insert(venue).values({
    id: venueId,
    leagueId: SECOND_LEAGUE.id,
    name: "Riverside Fields",
    slug: "riverside-fields",
    address: "100 River Rd, Springfield",
  });
  const fieldId = fixed<FieldId>(6);
  await db
    .insert(field)
    .values({ id: fieldId, venueId, name: "Field 1", sortOrder: 0 });
  await db.insert(fieldLayout).values({ fieldId, noLayoutNeeded: true });

  const teams = TEAMS.map((t, i) => ({
    id: fixed<TeamId>(10 + i),
    leagueId: SECOND_LEAGUE.id,
    name: t.name,
    slug: t.slug,
    colorHex: t.color,
  }));
  await db.insert(team).values(teams);
  const entries = teams.map((t, i) => ({
    id: fixed<TeamSeasonId>(20 + i),
    teamId: t.id,
    seasonId: fall.id,
    status: "confirmed" as const,
  }));
  await db.insert(teamSeason).values(entries);

  // The demo player plays here too, on the first team.
  const registrationId = fixed<RegistrationId>(30);
  await db.insert(registration).values({
    id: registrationId,
    seasonId: fall.id,
    userId: PERSONA_IDS.player,
    kind: "team_member",
    status: "active",
  });
  await db.insert(rosterMembership).values({
    registrationId,
    teamSeasonId: (entries[0] as (typeof entries)[number]).id,
    role: "player",
    status: "active",
  });

  // Two kickoffs a game day; the first day is played.
  const slots = GAME_DAYS.flatMap((date, day) =>
    [10, 11].map((hour, timeIndex) => {
      const startsAt = newYorkTime(date, hour);
      return {
        id: fixed<SlotId>(40 + day * 2 + timeIndex),
        seasonId: fall.id,
        fieldId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 50 * 60_000),
        timeIndex,
      };
    }),
  );
  await db.insert(slot).values(slots);
  const games = roundRobin(entries.length).flatMap((pairs, round) =>
    pairs.map(([a, b], i) => {
      const s = slots[round * 2 + i] as (typeof slots)[number];
      const played = round === 0;
      return {
        id: fixed<GameId>(60 + round * 2 + i),
        seasonId: fall.id,
        roundNo: round + 1,
        teamAId: (entries[a] as (typeof entries)[number]).id,
        teamBId: (entries[b] as (typeof entries)[number]).id,
        kind: "regular" as const,
        status: played ? ("final" as const) : ("scheduled" as const),
        slotId: s.id,
        scoreA: played ? 21 - i * 7 : null,
        scoreB: played ? 14 : null,
        finalizedAt: played ? new Date(s.endsAt.getTime() + 30 * 60_000) : null,
      };
    }),
  );
  await db.insert(game).values(games);
  await seedPublishedSchedule(db, fall.id);
}
