import type { Hex } from "@/domain/color/contrast";
import type {
  FieldId,
  GameId,
  LeagueId,
  RegistrationId,
  RosterMembershipId,
  SeasonId,
  SlotId,
  TeamId,
  TeamSeasonId,
  UserId,
  VenueId,
} from "@/domain/ids";
import { seededRandom, type Random } from "./random";

/**
 * Demo data for local development, previews and the demo deployment.
 * Pure and deterministic: the same seed always gives the same league, so
 * links into the demo survive a reseed. Every name is invented.
 */

export const SEED_EMAIL_DOMAIN = "seed.example";
export const SEED_LEAGUE_SLUG = "demo-league";

export const TEAMS: readonly {
  name: string;
  slug: string;
  color: Hex | null;
}[] = [
  { name: "The Big Kicks", slug: "the-big-kicks", color: "#1F3A8A" },
  { name: "Sun Kickers", slug: "sun-kickers", color: "#F5B301" },
  { name: "Base Invaders", slug: "base-invaders", color: null },
  { name: "Kickin' Chicken", slug: "kickin-chicken", color: "#DB3643" },
  { name: "Pitch Please", slug: "pitch-please", color: null },
  { name: "Red Rubber Ballers", slug: "red-rubber-ballers", color: "#8F1A1C" },
  { name: "Grand Slammers", slug: "grand-slammers", color: null },
  { name: "Foul Play", slug: "foul-play", color: "#2A9D8F" },
];

const FIRST_NAMES = [
  "Alex",
  "Amara",
  "Bea",
  "Caleb",
  "Dani",
  "Deshawn",
  "Eli",
  "Fatima",
  "Gabe",
  "Hana",
  "Iris",
  "Jamal",
  "Jess",
  "Kai",
  "Lena",
  "Luis",
  "Maya",
  "Mo",
  "Nadia",
  "Omar",
  "Priya",
  "Quinn",
  "Rosa",
  "Sam",
  "Tariq",
  "Uma",
  "Vic",
  "Wren",
  "Yusuf",
  "Zoe",
] as const;

const LAST_NAMES = [
  "Abara",
  "Bianchi",
  "Castillo",
  "Dubois",
  "Eriksen",
  "Fofana",
  "Goldberg",
  "Haddad",
  "Ivanova",
  "Jensen",
  "Kowalski",
  "Liang",
  "Mensah",
  "Nakamura",
  "Okafor",
  "Petrov",
  "Quintero",
  "Rahman",
  "Silva",
  "Takahashi",
  "Underwood",
  "Varga",
  "Whitfield",
  "Yilmaz",
] as const;

const SHIRT_SIZES = ["xs", "s", "m", "l", "xl", "xxl"] as const;

export const ROSTER_SIZE = 14;
/** Fall plays Tuesday evenings (summer is Sunday afternoons, spring Monday evenings). */
const GAME_DAYS = [
  "2026-09-15",
  "2026-09-22",
  "2026-09-29",
  "2026-10-06",
  "2026-10-13",
  "2026-10-20",
  "2026-10-27",
];
/** Rounds already played: the season is mid-way through. */
export const PLAYED_ROUNDS = 4;
const KICKOFF_HOURS = [20, 21] as const;
const FIELD_NAMES = ["Field 1", "Field 2", "Field 3"] as const;

/** A UUID v4 drawn from the seeded generator, so ids are stable across reseeds. */
function uuid(random: Random): string {
  const hex = Array.from({ length: 32 }, () => random.int(0, 15).toString(16));
  hex[12] = "4";
  hex[16] = ((random.int(0, 15) & 0x3) | 0x8).toString(16);
  const s = hex.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/**
 * The UTC instant of a wall-clock time in New York on a date, so kickoffs stay
 * at 10:00 and 11:00 local across the daylight-saving change.
 */
export function newYorkTime(date: string, hour: number): Date {
  const guess = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00Z`);
  const localHour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hourCycle: "h23",
    }).format(guess),
  );
  // At `guess`, New York reads `localHour`; it is this many hours behind UTC.
  const hoursBehind = (hour - localHour + 24) % 24;
  return new Date(guess.getTime() + hoursBehind * 3_600_000);
}

/** Round-robin pairings by the circle method: every team meets every other once. */
export function roundRobin(teamCount: number): [number, number][][] {
  const ids = Array.from({ length: teamCount }, (_, i) => i);
  const rounds: [number, number][][] = [];
  for (let round = 0; round < teamCount - 1; round++) {
    const pairs: [number, number][] = [];
    for (let i = 0; i < teamCount / 2; i++) {
      pairs.push([ids[i] as number, ids[teamCount - 1 - i] as number]);
    }
    rounds.push(round % 2 === 0 ? pairs : pairs.map(([a, b]) => [b, a]));
    ids.splice(1, 0, ids.pop() as number); // rotate everyone but the first
  }
  return rounds;
}

export type SeedData = ReturnType<typeof generateSeed>;

export function generateSeed(seed = 2026) {
  const random = seededRandom(seed);
  const id = <T extends string>() => uuid(random) as T;

  const league = {
    id: id<LeagueId>(),
    name: "Kickball League (demo)",
    slug: SEED_LEAGUE_SLUG,
    timezone: "America/New_York",
  };

  const season = {
    id: id<SeasonId>(),
    leagueId: league.id,
    name: "Fall 2026",
    slug: "fall-2026",
    status: "in_progress" as const,
    startsOn: GAME_DAYS[0] as string,
    endsOn: GAME_DAYS.at(-1) as string,
    registrationOpensAt: new Date("2026-07-15T13:00:00Z"),
    registrationClosesAt: new Date("2026-09-06T03:59:00Z"),
    paymentDeadlineAt: new Date("2026-09-10T03:59:00Z"),
    feeModel: "per_player" as const,
    playerFeeCents: 8500,
    freeAgentFeeCents: 8500,
    rosterMin: 12,
    rosterMax: 20,
  };

  const venue = {
    id: id<VenueId>(),
    leagueId: league.id,
    name: "McCarren Park",
    slug: "mccarren-park",
    address: "Driggs Ave & Lorimer St, Brooklyn, NY",
    neighborhood: "Williamsburg / Greenpoint",
  };
  const fields = FIELD_NAMES.map((name, sortOrder) => ({
    id: id<FieldId>(),
    venueId: venue.id,
    name,
    sortOrder,
  }));

  // People: an admin plus a full roster for every team.
  const usedNames = new Set<string>();
  const person = () => {
    for (;;) {
      const first = random.pick(FIRST_NAMES);
      const last = random.pick(LAST_NAMES);
      if (!usedNames.has(`${first} ${last}`)) {
        usedNames.add(`${first} ${last}`);
        return { first, last };
      }
    }
  };
  const users: {
    id: UserId;
    name: string;
    email: string;
    emailVerified: boolean;
  }[] = [];
  const profiles: {
    userId: UserId;
    firstName: string;
    lastName: string;
    gender: "woman" | "man" | "nonbinary";
    lineupGender: "woman" | "man";
    shirtSize: (typeof SHIRT_SIZES)[number];
    globalRole: "player" | "admin";
  }[] = [];
  const addUser = (role: "player" | "admin") => {
    const { first, last } = person();
    const userId = id<UserId>();
    users.push({
      id: userId,
      name: `${first} ${last}`,
      email:
        `${first}.${last}.${users.length + 1}@${SEED_EMAIL_DOMAIN}`.toLowerCase(),
      emailVerified: true,
    });
    const roll = random.next();
    const gender = roll < 0.47 ? "woman" : roll < 0.94 ? "man" : "nonbinary";
    profiles.push({
      userId,
      firstName: first,
      lastName: last,
      gender,
      lineupGender:
        gender === "nonbinary"
          ? random.pick(["woman", "man"] as const)
          : gender,
      shirtSize: random.pick(SHIRT_SIZES),
      globalRole: role,
    });
    return userId;
  };
  addUser("admin");

  const teams = TEAMS.map((t) => ({
    id: id<TeamId>(),
    leagueId: league.id,
    name: t.name,
    slug: t.slug,
    colorHex: t.color,
  }));
  const teamSeasons = teams.map((team) => ({
    id: id<TeamSeasonId>(),
    teamId: team.id,
    seasonId: season.id,
    status: "confirmed" as const,
    paymentMode: "split" as const,
    shareCents: season.playerFeeCents,
    targetRosterSize: ROSTER_SIZE,
  }));

  const registrations: {
    id: RegistrationId;
    seasonId: SeasonId;
    userId: UserId;
    kind: "team_member";
    status: "active";
  }[] = [];
  const rosterMemberships: {
    id: RosterMembershipId;
    teamSeasonId: TeamSeasonId;
    registrationId: RegistrationId;
    role: "captain" | "co_captain" | "player";
    status: "active";
    startedAt: Date;
    sharesContact: boolean;
  }[] = [];
  for (const entry of teamSeasons) {
    // One main captain (final calls, payment) and, as in the real league,
    // usually one to three co-captains.
    const coCaptains = random.int(1, 3);
    for (let spot = 0; spot < ROSTER_SIZE; spot++) {
      const registrationId = id<RegistrationId>();
      registrations.push({
        id: registrationId,
        seasonId: season.id,
        userId: addUser("player"),
        kind: "team_member",
        status: "active",
      });
      rosterMemberships.push({
        id: id<RosterMembershipId>(),
        teamSeasonId: entry.id,
        registrationId,
        role:
          spot === 0 ? "captain" : spot <= coCaptains ? "co_captain" : "player",
        status: "active",
        startedAt: new Date("2026-08-20T16:00:00Z"),
        sharesContact: random.next() < 0.6,
      });
    }
  }

  // Slots: every game day, every field, at each kickoff hour. Each slot's local
  // game day is kept aside: a 9 pm New York kickoff is already the next day in UTC.
  const gameDayOf = new Map<SlotId, string>();
  const slots = GAME_DAYS.flatMap((date) =>
    KICKOFF_HOURS.flatMap((hour, timeIndex) =>
      fields.map((field) => {
        const startsAt = newYorkTime(date, hour);
        const slotId = id<SlotId>();
        gameDayOf.set(slotId, date);
        return {
          id: slotId,
          seasonId: season.id,
          fieldId: field.id,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 55 * 60_000),
          timeIndex,
        };
      }),
    ),
  );

  // Games: one round per game day; the first rounds are already final.
  const games = roundRobin(teamSeasons.length).flatMap((pairs, round) => {
    const date = GAME_DAYS[round] as string;
    const daySlots = random.shuffle(
      slots.filter((s) => gameDayOf.get(s.id) === date),
    );
    return pairs.map(([a, b], i) => {
      const slot = daySlots[i];
      if (!slot) throw new Error(`Not enough slots on ${date}`);
      const played = round < PLAYED_ROUNDS;
      return {
        id: id<GameId>(),
        seasonId: season.id,
        roundNo: round + 1,
        teamAId: (teamSeasons[a] as (typeof teamSeasons)[number]).id,
        teamBId: (teamSeasons[b] as (typeof teamSeasons)[number]).id,
        kind: "regular" as const,
        status: played ? ("final" as const) : ("scheduled" as const),
        slotId: slot.id,
        scoreA: played ? random.int(0, 12) : null,
        scoreB: played ? random.int(0, 12) : null,
        inningsPlayed: played ? 7 : null,
        finalizedAt: played
          ? new Date(slot.endsAt.getTime() + 30 * 60_000)
          : null,
      };
    });
  });

  return {
    league,
    season,
    venue,
    fields,
    users,
    profiles,
    teams,
    teamSeasons,
    registrations,
    rosterMemberships,
    slots,
    games,
  };
}
