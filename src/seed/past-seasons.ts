import type { Db } from "@/db/queries/schedule";
import {
  game,
  registration,
  rosterMembership,
  season,
  slot,
  team,
  teamSeason,
  user,
} from "@/db/schema";
import type {
  GameId,
  RegistrationId,
  RosterMembershipId,
  SeasonId,
  SlotId,
  TeamId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { seededRandom } from "@/domain/random";
import {
  FIRST_NAMES,
  LAST_NAMES,
  newYorkTime,
  roundRobin,
  SEED_EMAIL_DOMAIN,
  type SeedData,
} from "./generate";
import { insertSeedFees, type SeedFee } from "./money-summary";
import { insertSeedProfiles } from "./roles";
import { seasonCardSeedRows } from "./season-cards";
import { seedPublishedSchedule } from "./published-schedule";

/**
 * Three completed seasons before the seeded fall, for the history page and
 * the all-time records on team pages: fall 2025 on Tuesday evenings, spring
 * 2026 on Monday evenings and summer 2026 on Sunday afternoons, each a full
 * round robin with every score in. Two invented teams played then and have
 * since stopped. Each team is given a strength, so one team wins twice and
 * another once.
 *
 * Pure and deterministic, with fixed ids, so links into the demo survive a
 * reseed and the generated league's own ids stay the same.
 */

/** Teams that played in past seasons only. */
export const RETIRED_TEAMS = [
  { name: "Kick Starters", slug: "kick-starters", color: "#6B3FA0" },
  { name: "Rubber Duckies", slug: "rubber-duckies", color: "#E9C46A" },
] as const;

type PastSeasonPlan = {
  name: string;
  slug: string;
  days: readonly string[];
  hours: readonly [number, number];
  /** Team slugs that entered, and how much each one adds to its scores. */
  teams: Readonly<Record<string, number>>;
  /** A team that forfeited its game in this round (1-based), if any. */
  forfeit?: { round: number; team: string };
};

export const PAST_SEASONS: readonly PastSeasonPlan[] = [
  {
    name: "Fall 2025",
    slug: "fall-2025",
    days: [
      "2025-09-16",
      "2025-09-23",
      "2025-09-30",
      "2025-10-07",
      "2025-10-14",
    ],
    hours: [20, 21],
    teams: {
      "kick-starters": 2,
      "the-big-kicks": 1,
      "sun-kickers": 5,
      "base-invaders": 0,
      "kickin-chicken": 1,
      "rubber-duckies": 0,
    },
  },
  {
    name: "Spring 2026",
    slug: "spring-2026",
    days: [
      "2026-04-06",
      "2026-04-13",
      "2026-04-20",
      "2026-04-27",
      "2026-05-04",
      "2026-05-11",
      "2026-05-18",
    ],
    hours: [20, 21],
    teams: {
      "sun-kickers": 5,
      "kick-starters": 2,
      "the-big-kicks": 2,
      "base-invaders": 1,
      "kickin-chicken": 0,
      "pitch-please": 1,
      "red-rubber-ballers": 0,
      "grand-slammers": 0,
    },
  },
  {
    name: "Summer 2026",
    slug: "summer-2026",
    days: [
      "2026-06-14",
      "2026-06-21",
      "2026-06-28",
      "2026-07-12",
      "2026-07-19",
      "2026-07-26",
      "2026-08-02",
    ],
    hours: [14, 15],
    teams: {
      "sun-kickers": 4,
      "foul-play": 3,
      "the-big-kicks": 1,
      "base-invaders": 0,
      "kickin-chicken": 2,
      "pitch-please": 0,
      "red-rubber-ballers": 1,
      "grand-slammers": 0,
    },
    forfeit: { round: 3, team: "grand-slammers" },
  },
];

/** Fixed ids in their own range, apart from the generated league's. */
const pastId = <T extends string>(n: number) =>
  `a15e0000-0000-4000-8000-${String(n).padStart(12, "0")}` as T;

export function generatePastSeasons(data: SeedData) {
  const random = seededRandom(1405);
  let n = 0;
  const next = <T extends string>() => pastId<T>(++n);

  const retired = RETIRED_TEAMS.map((t) => ({
    id: next<TeamId>(),
    leagueId: data.league.id,
    name: t.name,
    slug: t.slug,
    colorHex: t.color,
  }));
  const teamBySlug = new Map(
    [...data.teams, ...retired].map((t) => [t.slug, t]),
  );
  const fields = data.fields;

  return {
    teams: retired,
    seasons: PAST_SEASONS.map((plan) => {
      const s = {
        id: next<SeasonId>(),
        leagueId: data.league.id,
        name: plan.name,
        slug: plan.slug,
        status: "completed" as const,
        startsOn: plan.days[0] as string,
        endsOn: plan.days.at(-1) as string,
        feeModel: "per_player" as const,
        playerFeeCents: 8000,
        freeAgentFeeCents: 8000,
        rosterMin: 12,
        rosterMax: 20,
        waiverId: data.waiver.id,
      };
      const slugs = Object.keys(plan.teams);
      const entries = slugs.map((slug) => {
        const t = teamBySlug.get(slug);
        if (!t) throw new Error(`Unknown seed team ${slug}`);
        return {
          id: next<TeamSeasonId>(),
          teamId: t.id,
          seasonId: s.id,
          status: "confirmed" as const,
        };
      });
      const slots: (typeof slot.$inferInsert & { id: SlotId })[] = [];
      const games: (typeof game.$inferInsert)[] = [];
      roundRobin(slugs.length).forEach((pairs, round) => {
        const date = plan.days[round] as string;
        const daySlots = plan.hours.flatMap((hour, timeIndex) =>
          fields.map((field) => {
            const startsAt = newYorkTime(date, hour);
            const row = {
              id: next<SlotId>(),
              seasonId: s.id,
              fieldId: field.id,
              startsAt,
              endsAt: new Date(startsAt.getTime() + 55 * 60_000),
              timeIndex,
            };
            slots.push(row);
            return row;
          }),
        );
        pairs.forEach(([a, b], i) => {
          const where = daySlots[i];
          if (!where) throw new Error(`Not enough slots on ${date}`);
          const [slugA, slugB] = [slugs[a] as string, slugs[b] as string];
          const [entryA, entryB] = [entries[a], entries[b]];
          if (!entryA || !entryB) throw new Error("Missing seed entry");
          const finalizedAt = new Date(where.endsAt.getTime() + 30 * 60_000);
          const base = {
            id: next<GameId>(),
            seasonId: s.id,
            roundNo: round + 1,
            teamAId: entryA.id,
            teamBId: entryB.id,
            kind: "regular" as const,
            slotId: where.id,
            finalizedAt,
          };
          const forfeits =
            plan.forfeit?.round === round + 1 &&
            (plan.forfeit.team === slugA || plan.forfeit.team === slugB);
          if (forfeits) {
            games.push({
              ...base,
              status: "forfeit",
              forfeitBy: plan.forfeit?.team === slugA ? entryA.id : entryB.id,
            });
            return;
          }
          games.push({
            ...base,
            status: "final",
            scoreA: random.int(0, 9) + (plan.teams[slugA] ?? 0),
            scoreB: random.int(0, 9) + (plan.teams[slugB] ?? 0),
            inningsPlayed: 7,
          });
        });
      });
      return { season: s, entries, slots, games };
    }),
  };
}

/** The past seasons whose rosters the seed fills in: all three. */
export const ROSTERED_PAST_SEASONS = [
  "fall-2025",
  "spring-2026",
  "summer-2026",
] as const;

/** Players on each past roster. */
const PAST_ROSTER = 12;

/** Fixed ids for past rosters, apart from the seasons' own. */
const rosterId = <T extends string>(n: number) =>
  `a15e1000-0000-4000-8000-${String(n).padStart(12, "0")}` as T;

/**
 * Who played in the completed seasons, so their history, books and
 * dashboard count members: twelve on each team, its captain first. A team
 * still playing brings twelve of its fall players (their captain leads);
 * the retired teams' players are their own invented people, who have since
 * stopped. Each paid the season's fee, most of them in the app. In Summer
 * 2026 the season cards' six players (src/seed/season-cards.ts) already
 * hold their team's first spots, captain included, so that team is topped
 * up to twelve around them.
 */
export function pastSeasonMembers(data: SeedData) {
  const past = generatePastSeasons(data);
  const cards = seasonCardSeedRows(data);
  const carded = new Set(cards.registrations.map((r) => r.userId));
  const cardTeam = cards.memberships[0]?.teamSeasonId;
  const random = seededRandom(2025);
  let n = 0;
  const next = <T extends string>() => rosterId<T>(++n);

  // The fall roster of each team still playing, captain first.
  const fallRoster = new Map<TeamId, UserId[]>();
  for (const t of data.teamSeasons) {
    const own = data.rosterMemberships
      .filter((m) => m.teamSeasonId === t.id)
      .sort(
        (a, b) => Number(b.role === "captain") - Number(a.role === "captain"),
      );
    fallRoster.set(
      t.teamId,
      own.flatMap((m) => {
        const r = data.registrations.find((x) => x.id === m.registrationId);
        return r ? [r.userId] : [];
      }),
    );
  }

  // The retired teams' own players.
  const taken = new Set(data.users.map((u) => u.name));
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
    gender: "woman" | "man";
    lineupGender: "woman" | "man";
    shirtSize: "m";
    globalRole: "player";
  }[] = [];
  for (const t of past.teams) {
    const roster: UserId[] = [];
    while (roster.length < PAST_ROSTER) {
      const first = random.pick(FIRST_NAMES);
      const last = random.pick(LAST_NAMES);
      const name = `${first} ${last}`;
      if (taken.has(name)) continue;
      taken.add(name);
      const id = next<UserId>();
      const side = roster.length % 2 === 0 ? "woman" : "man";
      users.push({
        id,
        name,
        email: `${first}.${last}.p${n}@${SEED_EMAIL_DOMAIN}`.toLowerCase(),
        emailVerified: true,
      });
      profiles.push({
        userId: id,
        firstName: first,
        lastName: last,
        gender: side,
        lineupGender: side,
        shirtSize: "m",
        globalRole: "player",
      });
      roster.push(id);
    }
    fallRoster.set(t.id, roster);
  }

  const registrations: (typeof registration.$inferInsert & {
    id: RegistrationId;
    seasonId: SeasonId;
    userId: UserId;
  })[] = [];
  const memberships: (typeof rosterMembership.$inferInsert)[] = [];
  const fees: SeedFee[] = [];
  for (const p of past.seasons) {
    if (!(ROSTERED_PAST_SEASONS as readonly string[]).includes(p.season.slug))
      continue;
    const signUp = new Date(`${p.season.startsOn}T16:00:00Z`);
    signUp.setUTCDate(signUp.getUTCDate() - 21);
    for (const entry of p.entries) {
      const held = entry.id === cardTeam ? carded.size : 0;
      const roster = (fallRoster.get(entry.teamId) ?? [])
        .filter((u) => p.season.id !== cards.seasonId || !carded.has(u))
        .slice(0, PAST_ROSTER - held);
      for (const [i, userId] of roster.entries()) {
        const spot = i + held;
        const reg = {
          id: next<RegistrationId>(),
          seasonId: p.season.id,
          userId,
          kind: "team_member" as const,
          status: "active" as const,
        };
        registrations.push(reg);
        memberships.push({
          id: next<RosterMembershipId>(),
          teamSeasonId: entry.id,
          registrationId: reg.id,
          role: spot === 0 ? "captain" : "player",
          status: "active",
          startedAt: signUp,
        });
        fees.push({
          userId,
          seasonId: p.season.id,
          registrationId: reg.id,
          teamSeasonId: entry.id,
          amountCents: p.season.playerFeeCents,
          description: `${p.season.name} player fee`,
          paidAt: new Date(signUp.getTime() + (spot % 7) * 86_400_000),
          key: `${p.season.slug}_${registrations.length}`,
        });
      }
    }
  }
  return { users, profiles, registrations, memberships, fees };
}

/** Adds the past seasons to a freshly seeded league, schedules published. */
export async function addPastSeasons(db: Db, data: SeedData): Promise<void> {
  const past = generatePastSeasons(data);
  await db.insert(team).values(past.teams);
  for (const p of past.seasons) {
    await db.insert(season).values(p.season);
    await db.insert(teamSeason).values(p.entries);
    await db.insert(slot).values(p.slots);
    await db.insert(game).values(p.games);
    await seedPublishedSchedule(db, p.season.id);
  }
  const members = pastSeasonMembers(data);
  await db.insert(user).values(members.users);
  await insertSeedProfiles(db, data.league.id, members.profiles);
  await db.insert(registration).values(members.registrations);
  await db.insert(rosterMembership).values(members.memberships);
  const admin = data.profiles.find((p) => p.globalRole === "admin");
  if (admin)
    await insertSeedFees(db, data.league.id, admin.userId, members.fees);
}
