import type { Db } from "@/db/queries/schedule";
import { game, season, slot, team, teamSeason } from "@/db/schema";
import type {
  GameId,
  SeasonId,
  SlotId,
  TeamId,
  TeamSeasonId,
} from "@/domain/ids";
import { seededRandom } from "@/domain/random";
import { newYorkTime, roundRobin, type SeedData } from "./generate";
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
}
