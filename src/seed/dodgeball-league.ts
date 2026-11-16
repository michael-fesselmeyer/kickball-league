import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/queries/schedule";
import { auditLog } from "@/db/schema/audit";
import { user } from "@/db/schema/auth";
import { ruleSet } from "@/db/schema/division";
import {
  field,
  game,
  scoreReport,
  scoreResponse,
  slot,
  venue,
} from "@/db/schema/game";
import { league, leagueMember } from "@/db/schema/league";
import { profile } from "@/db/schema/profile";
import { scheduleVersion } from "@/db/schema/schedule";
import { season } from "@/db/schema/season";
import { team, teamSeason } from "@/db/schema/team";
import type {
  FieldId,
  GameId,
  LeagueId,
  RuleSetId,
  SeasonId,
  SlotId,
  TeamId,
  TeamSeasonId,
  UserId,
  VenueId,
} from "@/domain/ids";
import { newYorkTime, roundRobin, SEED_EMAIL_DOMAIN } from "./generate";
import { seedPublishedSchedule } from "./published-schedule";

/**
 * A dodgeball league on the same deployment (ADR 0087), the first sport
 * with rules of its own after kickball: best-of-five matches on the
 * courts of a gym, with its own admin, four teams and a season two weeks
 * in. Everything is invented.
 */
export const DODGEBALL_LEAGUE_SLUG = "dodgeball";

/** Fixed ids, so the tests can name them. */
const fixed = <T extends string>(n: number) =>
  `f0469000-0000-4000-8000-${String(n).padStart(12, "0")}` as T;

export const DODGEBALL_LEAGUE = {
  id: fixed<LeagueId>(1),
  name: "Thursday Dodgeball (demo)",
  slug: DODGEBALL_LEAGUE_SLUG,
  sport: "dodgeball",
  timezone: "America/New_York",
  minimumAge: 21,
  branding: { primaryColor: "#7C2D12", secondaryColor: "#FACC15" },
};

/** Its admin, who has no role in the other leagues. */
export const DODGEBALL_ADMIN = {
  id: fixed<UserId>(2),
  first: "Dot",
  last: "Dodgewell",
  email: `dot.dodgewell@${SEED_EMAIL_DOMAIN}`,
};

export const DODGEBALL_SEASON_SLUG = "winter-2026";

const TEAMS = [
  { name: "Ball Busters", slug: "ball-busters", color: "#7C2D12" },
  { name: "Duck Dynasty", slug: "duck-dynasty", color: "#0F766E" },
  { name: "Gym Class Heroes", slug: "gym-class-heroes", color: "#6D28D9" },
  { name: "Thursday Throwers", slug: "thursday-throwers", color: null },
] as const;

/** Three Thursdays: two played, the last waiting for its scores. */
const GAME_DAYS = ["2026-10-29", "2026-11-05", "2026-11-12"] as const;

/** Sets won in the played matches, best of five: [team A, team B]. */
const RESULTS: readonly (readonly [number, number])[] = [
  [3, 1],
  [2, 3],
  [3, 0],
  [3, 2],
];

/** Removes the dodgeball league and everything in it, children first. */
export async function removeDodgeballLeague(db: Db): Promise<void> {
  const [found] = await db
    .select({ id: league.id })
    .from(league)
    .where(eq(league.slug, DODGEBALL_LEAGUE_SLUG));
  if (!found) return;
  const seasons = (
    await db
      .select({ id: season.id })
      .from(season)
      .where(eq(season.leagueId, found.id))
  ).map((s) => s.id);
  if (seasons.length > 0) {
    await db
      .delete(scheduleVersion)
      .where(inArray(scheduleVersion.seasonId, seasons));
    const games = (
      await db
        .select({ id: game.id })
        .from(game)
        .where(inArray(game.seasonId, seasons))
    ).map((g) => g.id);
    // Scores entered on the demo, by the tests or a visitor.
    if (games.length > 0) {
      const reports = (
        await db
          .select({ id: scoreReport.id })
          .from(scoreReport)
          .where(inArray(scoreReport.gameId, games))
      ).map((r) => r.id);
      if (reports.length > 0)
        await db
          .delete(scoreResponse)
          .where(inArray(scoreResponse.scoreReportId, reports));
      await db.delete(scoreReport).where(inArray(scoreReport.gameId, games));
    }
    await db.delete(game).where(inArray(game.seasonId, seasons));
    await db.delete(slot).where(inArray(slot.seasonId, seasons));
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
  await db.delete(user).where(eq(user.id, DODGEBALL_ADMIN.id));
}

/** Adds the dodgeball league after the kickball league is seeded. */
export async function addDodgeballLeague(db: Db): Promise<void> {
  await db.insert(league).values({ ...DODGEBALL_LEAGUE, isDefault: false });
  await db.insert(ruleSet).values({
    id: fixed<RuleSetId>(3),
    leagueId: DODGEBALL_LEAGUE.id,
    name: "Standard",
    bestOf: 5,
    timeLimitMinutes: 45,
  });

  await db.insert(user).values({
    id: DODGEBALL_ADMIN.id,
    name: `${DODGEBALL_ADMIN.first} ${DODGEBALL_ADMIN.last}`,
    email: DODGEBALL_ADMIN.email,
    emailVerified: true,
  });
  await db.insert(profile).values({
    userId: DODGEBALL_ADMIN.id,
    firstName: DODGEBALL_ADMIN.first,
    lastName: DODGEBALL_ADMIN.last,
  });
  await db.insert(leagueMember).values({
    leagueId: DODGEBALL_LEAGUE.id,
    userId: DODGEBALL_ADMIN.id,
    role: "admin",
  });

  const winter = {
    id: fixed<SeasonId>(4),
    leagueId: DODGEBALL_LEAGUE.id,
    name: "Winter 2026",
    slug: DODGEBALL_SEASON_SLUG,
    status: "in_progress" as const,
    startsOn: GAME_DAYS[0],
    endsOn: GAME_DAYS[2],
    feeModel: "per_team" as const,
    teamFeeCents: 45000,
    rosterMin: 6,
    rosterMax: 12,
  };
  await db.insert(season).values(winter);

  // A gym, not a park: its courts are the venue's playing areas.
  const venueId = fixed<VenueId>(5);
  await db.insert(venue).values({
    id: venueId,
    leagueId: DODGEBALL_LEAGUE.id,
    name: "Eastside Rec Center",
    slug: "eastside-rec-center",
    address: "200 Example Ave, Springfield",
  });
  const courts = [0, 1].map((i) => ({
    id: fixed<FieldId>(6 + i),
    venueId,
    name: `Court ${i + 1}`,
    sortOrder: i,
  }));
  await db.insert(field).values(courts);

  const teams = TEAMS.map((t, i) => ({
    id: fixed<TeamId>(10 + i),
    leagueId: DODGEBALL_LEAGUE.id,
    name: t.name,
    slug: t.slug,
    colorHex: t.color,
  }));
  await db.insert(team).values(teams);
  const entries = teams.map((t, i) => ({
    id: fixed<TeamSeasonId>(20 + i),
    teamId: t.id,
    seasonId: winter.id,
    status: "confirmed" as const,
  }));
  await db.insert(teamSeason).values(entries);

  // Both courts at 7 PM each Thursday.
  const slots = GAME_DAYS.flatMap((date, day) =>
    courts.map((court, timeIndex) => {
      const startsAt = newYorkTime(date, 19);
      return {
        id: fixed<SlotId>(40 + day * 2 + timeIndex),
        seasonId: winter.id,
        fieldId: court.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 45 * 60_000),
        timeIndex: 0,
      };
    }),
  );
  await db.insert(slot).values(slots);
  const games = roundRobin(entries.length).flatMap((pairs, round) =>
    pairs.map(([a, b], i) => {
      const s = slots[round * 2 + i] as (typeof slots)[number];
      const result = round < 2 ? RESULTS[round * 2 + i] : undefined;
      return {
        id: fixed<GameId>(60 + round * 2 + i),
        seasonId: winter.id,
        roundNo: round + 1,
        teamAId: (entries[a] as (typeof entries)[number]).id,
        teamBId: (entries[b] as (typeof entries)[number]).id,
        kind: "regular" as const,
        status: result ? ("final" as const) : ("scheduled" as const),
        slotId: s.id,
        scoreA: result ? result[0] : null,
        scoreB: result ? result[1] : null,
        finalizedAt: result ? new Date(s.endsAt.getTime() + 30 * 60_000) : null,
      };
    }),
  );
  await db.insert(game).values(games);
  await seedPublishedSchedule(db, winter.id);
}
